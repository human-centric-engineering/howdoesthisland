/**
 * Tests: `purgeExpiredContent` — the per-workspace retention purge (t-26).
 *
 * The database is a small stateful fake of content, assessments and judge
 * runs across two workspaces, with the FK cascades the schema declares
 * (content → assessment → judge run). It reads the `where` clauses the purge
 * sends, so each test asserts on the rows left behind, not on the calls made.
 * Every population holds rows on both sides of each cutoff, so a purge that
 * did nothing, or did everything, fails.
 *
 * The reply-clearing step is raw SQL; the fake checks its statement holds
 * the clauses it models. What only a real database can show (that SQL, and
 * the relation filter, behaving as the fake assumes under the tenant scope)
 * was checked by running the purge against the development database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Status = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
interface ContentRow {
  id: string;
  orgId: string;
  createdAt: Date;
}
interface AssessmentRow {
  id: string;
  orgId: string;
  contentId: string;
  status: Status;
  createdAt: Date;
}
interface JudgeRunRow {
  id: string;
  orgId: string;
  assessmentId: string;
  createdAt: Date;
  output: unknown;
  dropped: unknown;
}

const db = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  contents: [] as ContentRow[],
  assessments: [] as AssessmentRow[],
  judgeRuns: [] as JudgeRunRow[],
  orgId: '',
}));

/** The fake's reading of the clauses the purge sends. Unknown keys throw. */
const fake = vi.hoisted(() => {
  const allowed = (where: Record<string, unknown>, keys: string[]) => {
    for (const k of Object.keys(where)) {
      if (!keys.includes(k)) throw new Error(`fake does not model where.${k}`);
    }
  };
  const before = (at: Date, clause: unknown) =>
    clause === undefined || at < (clause as { lt: Date }).lt;
  const statusOk = (status: string, clause: unknown) =>
    clause === undefined || !(clause as { notIn: string[] }).notIn.includes(status);
  return { allowed, before, statusOk };
});

const fakePrisma = vi.hoisted(() => {
  const isNull = (v: unknown) => v === null || v === undefined;
  /** Delete assessments and cascade to their judge runs. */
  const dropAssessments = (ids: Set<string>) => {
    db.assessments = db.assessments.filter((a) => !ids.has(a.id));
    db.judgeRuns = db.judgeRuns.filter((r) => !ids.has(r.assessmentId));
  };
  return {
    org: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(db.settings.has(where.id) ? { settings: db.settings.get(where.id) } : null)
      ),
    },
    assessment: {
      deleteMany: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        fake.allowed(where, ['orgId', 'createdAt', 'status']);
        const hit = db.assessments.filter(
          (a) =>
            a.orgId === where.orgId &&
            fake.before(a.createdAt, where.createdAt) &&
            fake.statusOk(a.status, where.status)
        );
        dropAssessments(new Set(hit.map((a) => a.id)));
        return Promise.resolve({ count: hit.length });
      }),
    },
    content: {
      deleteMany: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        fake.allowed(where, ['orgId', 'createdAt', 'assessments']);
        if (JSON.stringify(where.assessments) !== JSON.stringify({ none: {} })) {
          throw new Error('fake models only `assessments: { none: {} }`');
        }
        const hit = db.contents.filter(
          (c) =>
            c.orgId === where.orgId &&
            fake.before(c.createdAt, where.createdAt) &&
            !db.assessments.some((a) => a.contentId === c.id)
        );
        const ids = new Set(hit.map((c) => c.id));
        db.contents = db.contents.filter((c) => !ids.has(c.id));
        dropAssessments(
          new Set(db.assessments.filter((a) => ids.has(a.contentId)).map((a) => a.id))
        );
        return Promise.resolve({ count: hit.length });
      }),
    },
    /**
     * The reply-clearing UPDATE. The fake checks the statement says what the
     * purge relies on, then applies that meaning; the real statement is run
     * against the development database (see the header).
     */
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?').replace(/\s+/g, ' ');
      for (const part of [
        'UPDATE "app_judge_run" AS r',
        'SET "output" = NULL, "dropped" = NULL',
        'FROM "app_assessment" AS a WHERE a."id" = r."assessmentId"',
        'r."orgId" = ?',
        'r."createdAt" < ?',
        `a."status"::text NOT IN ('QUEUED', 'RUNNING')`,
        '(r."output" IS NOT NULL OR r."dropped" IS NOT NULL)',
      ]) {
        if (!sql.includes(part)) throw new Error(`fake does not model this statement: ${sql}`);
      }
      const [, orgId, cutoff] = values as [Date, string, Date];
      const hit = db.judgeRuns.filter((r) => {
        const parent = db.assessments.find((x) => x.id === r.assessmentId);
        return (
          r.orgId === orgId &&
          r.createdAt < cutoff &&
          parent !== undefined &&
          !['QUEUED', 'RUNNING'].includes(parent.status) &&
          !(isNull(r.output) && isNull(r.dropped))
        );
      });
      for (const r of hit) {
        r.output = null;
        r.dropped = null;
      }
      return Promise.resolve(hit.length);
    }),
  };
});
vi.mock('@/lib/db/client', () => ({ prisma: fakePrisma }));
vi.mock('@/lib/tenancy/context', () => ({
  requireOrgId: () => {
    if (!db.orgId) throw new Error('no tenant context');
    return db.orgId;
  },
}));

import { purgeExpiredContent } from '@/lib/app/retention/purge';

const WS = 'cmorg000000000000000team1';
const OTHER = 'cmorg0000000000000000org2';
const NOW = new Date('2026-11-15T12:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);
const REPLY = { dimensions: { ethos: 3 } };
const DROPS = [{ field: 'quote', reason: 'unlocatable' }];

let seq = 0;
/** One content row, one assessment on it, and one judge run with a reply. */
function piece(orgId: string, ageDays: number, status: Status = 'COMPLETED') {
  const n = ++seq;
  const content = { id: `c${n}`, orgId, createdAt: daysAgo(ageDays) };
  const assessment = {
    id: `a${n}`,
    orgId,
    contentId: content.id,
    status,
    createdAt: daysAgo(ageDays),
  };
  const run: JudgeRunRow = {
    id: `r${n}`,
    orgId,
    assessmentId: assessment.id,
    createdAt: daysAgo(ageDays),
    output: structuredClone(REPLY),
    dropped: structuredClone(DROPS),
  };
  db.contents.push(content);
  db.assessments.push(assessment);
  db.judgeRuns.push(run);
  return { content, assessment, run };
}

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();
const run = (id: string) => db.judgeRuns.find((r) => r.id === id);

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  db.settings.clear();
  db.contents = [];
  db.assessments = [];
  db.judgeRuns = [];
  db.orgId = WS;
});

describe('with a retention window', () => {
  beforeEach(() => {
    db.settings.set(WS, { quotas: { monthlyBudgetUsd: 10 }, app: { retention: { days: 90 } } });
    db.settings.set(OTHER, null);
  });

  it('deletes content and assessments past the window, keeping those inside it', async () => {
    const old = piece(WS, 120);
    const older = piece(WS, 400, 'FAILED');
    const recent = piece(WS, 10);
    const edge = piece(WS, 89);

    const result = await purgeExpiredContent(NOW);

    expect(result).toMatchObject({ assessments: 2, contents: 2 });
    expect(ids(db.assessments)).toEqual(ids([recent.assessment, edge.assessment]));
    expect(ids(db.contents)).toEqual(ids([recent.content, edge.content]));
    // Their judge runs went with them (the cascade).
    expect(run(old.run.id)).toBeUndefined();
    expect(run(older.run.id)).toBeUndefined();
  });

  it('a second pass changes nothing', async () => {
    piece(WS, 120);
    piece(WS, 45);
    piece(WS, 10);
    await purgeExpiredContent(NOW);
    const after = structuredClone({ c: db.contents, a: db.assessments, r: db.judgeRuns });

    const second = await purgeExpiredContent(NOW);

    expect(second).toEqual({ assessments: 0, contents: 0, repliesCleared: 0 });
    expect({ c: db.contents, a: db.assessments, r: db.judgeRuns }).toEqual(after);
  });

  it('keeps old content that a newer assessment is still on, until that one ages out', async () => {
    const old = piece(WS, 120);
    // A second assessment of the same text, inside the window.
    db.assessments.push({
      id: 'a-new',
      orgId: WS,
      contentId: old.content.id,
      status: 'COMPLETED',
      createdAt: daysAgo(5),
    });

    const result = await purgeExpiredContent(NOW);

    expect(result).toMatchObject({ assessments: 1, contents: 0 });
    expect(ids(db.contents)).toEqual([old.content.id]);
    expect(ids(db.assessments)).toEqual(['a-new']);
  });

  it('leaves a queued or running assessment past the window, and its content', async () => {
    const queued = piece(WS, 120, 'QUEUED');
    const running = piece(WS, 120, 'RUNNING');
    const done = piece(WS, 120, 'CANCELLED');

    await purgeExpiredContent(NOW);

    expect(ids(db.assessments)).toEqual(ids([queued.assessment, running.assessment]));
    expect(ids(db.contents)).toEqual(ids([queued.content, running.content]));
    expect(run(done.run.id)).toBeUndefined();
    // A live run's finished judges keep their replies, which a re-drive reads.
    expect(run(queued.run.id)?.output).toEqual(REPLY);
  });

  it('touches no other workspace', async () => {
    const theirs = piece(OTHER, 400);
    piece(WS, 400);

    await purgeExpiredContent(NOW);

    expect(db.assessments.map((a) => a.id)).toEqual([theirs.assessment.id]);
    expect(run(theirs.run.id)?.output).toEqual(REPLY);
  });
});

describe('judge runs’ replies', () => {
  it('are cleared after 30 days even inside the window, keeping the rows', async () => {
    db.settings.set(WS, { app: { retention: { days: 365 } } });
    const month = piece(WS, 45);
    const fresh = piece(WS, 29);

    const result = await purgeExpiredContent(NOW);

    expect(result).toEqual({ assessments: 0, contents: 0, repliesCleared: 1 });
    expect(run(month.run.id)).toMatchObject({ output: null, dropped: null });
    expect(run(fresh.run.id)).toMatchObject({ output: REPLY, dropped: DROPS });
    expect(ids(db.assessments)).toHaveLength(2);
  });

  it('a run with only `dropped` left is still cleared, and a cleared one is not counted again', async () => {
    const half = piece(WS, 45);
    half.run.output = null;
    const gone = piece(WS, 45);
    gone.run.output = null;
    gone.run.dropped = null;

    expect((await purgeExpiredContent(NOW)).repliesCleared).toBe(1);
    expect(run(half.run.id)?.dropped).toBeNull();
    expect((await purgeExpiredContent(NOW)).repliesCleared).toBe(0);
  });
});

describe('with no window', () => {
  it('keeps every content row and assessment, clearing only replies past 30 days', async () => {
    db.settings.set(WS, { quotas: { monthlyBudgetUsd: 10 } });
    const ancient = piece(WS, 2000);
    const month = piece(WS, 31);
    const fresh = piece(WS, 3);

    const result = await purgeExpiredContent(NOW);

    expect(result).toEqual({ assessments: 0, contents: 0, repliesCleared: 2 });
    expect(ids(db.contents)).toEqual(ids([ancient.content, month.content, fresh.content]));
    expect(ids(db.assessments)).toHaveLength(3);
    expect(run(ancient.run.id)?.output).toBeNull();
    expect(run(month.run.id)?.output).toBeNull();
    expect(run(fresh.run.id)?.output).toEqual(REPLY);
    expect(fakePrisma.assessment.deleteMany).not.toHaveBeenCalled();
    expect(fakePrisma.content.deleteMany).not.toHaveBeenCalled();
  });

  it('reads an unreadable window as none, deleting nothing', async () => {
    db.settings.set(WS, { app: { retention: { days: -1 } } });
    piece(WS, 400);

    await purgeExpiredContent(NOW);

    expect(db.assessments).toHaveLength(1);
    expect(db.contents).toHaveLength(1);
  });
});
