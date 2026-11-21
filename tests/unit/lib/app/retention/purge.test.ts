/**
 * Tests: `purgeExpiredContent` — the per-workspace retention purge (t-26).
 *
 * The database is a small stateful fake of content, assessments, judge runs
 * and judge replies across two workspaces, with the FK cascades the schema
 * declares (content → assessment → judge run → reply). It reads the `where`
 * clauses the purge sends, and throws on any it does not model, so each test
 * asserts on the rows left behind rather than on the calls made. Every
 * population holds rows on both sides of each cutoff, so a purge that did
 * nothing, or everything, fails.
 *
 * What only a real database shows (the relation filters, under the tenant
 * scope) was checked by running the purge against the development database.
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
  leaseExpiresAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}
interface JudgeRunRow {
  id: string;
  orgId: string;
  assessmentId: string;
}
interface ReplyRow {
  id: string;
  orgId: string;
  judgeRunId: string;
  createdAt: Date;
}

const db = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  contents: [] as ContentRow[],
  assessments: [] as AssessmentRow[],
  judgeRuns: [] as JudgeRunRow[],
  replies: [] as ReplyRow[],
  orgId: '',
}));

const fakePrisma = vi.hoisted(() => {
  const allowed = (where: Record<string, unknown>, keys: string[]) => {
    for (const k of Object.keys(where)) {
      if (!keys.includes(k)) throw new Error(`fake does not model where.${k}`);
    }
  };
  const before = (at: Date, clause: unknown) => at < (clause as { lt: Date }).lt;
  /**
   * The purge's `settled` filter, modelled exactly: a status outside
   * `notIn`, and a null lease or a `completedAt` before `lt`. Any other
   * shape throws.
   */
  const settled = (
    a: { status: string; leaseExpiresAt: Date | null; completedAt: Date | null },
    clause: unknown
  ) => {
    const c = clause as {
      status?: { notIn?: string[] };
      OR?: [{ leaseExpiresAt?: null }, { completedAt?: { lt: Date } }];
    };
    const ended = c.OR?.[1]?.completedAt?.lt;
    if (
      !c.status?.notIn ||
      c.OR?.length !== 2 ||
      c.OR[0].leaseExpiresAt !== null ||
      !(ended instanceof Date) ||
      Object.keys(c).join() !== 'status,OR'
    ) {
      throw new Error("fake models only the purge's settled filter");
    }
    return (
      !c.status.notIn.includes(a.status) &&
      (a.leaseExpiresAt === null || (a.completedAt !== null && a.completedAt < ended))
    );
  };
  /**
   * The assessments the purge's `where` names: past the cutoff and settled,
   * in one org, and (on the delete) among the ids whose PDFs were cleared.
   */
  const expired = (where: Record<string, unknown>) => {
    allowed(where, ['orgId', 'createdAt', 'status', 'OR', 'id']);
    const { orgId, createdAt, id, ...rest } = where;
    const idCond = (id ?? {}) as { in?: string[]; notIn?: string[] };
    return db.assessments.filter(
      (a) =>
        a.orgId === orgId &&
        before(a.createdAt, createdAt) &&
        settled(a, rest) &&
        (idCond.in === undefined || idCond.in.includes(a.id)) &&
        (idCond.notIn === undefined || !idCond.notIn.includes(a.id))
    );
  };
  /** Delete assessments, cascading to their judge runs and replies. */
  const dropAssessments = (ids: Set<string>) => {
    db.assessments = db.assessments.filter((a) => !ids.has(a.id));
    const runs = new Set(db.judgeRuns.filter((r) => ids.has(r.assessmentId)).map((r) => r.id));
    db.judgeRuns = db.judgeRuns.filter((r) => !runs.has(r.id));
    db.replies = db.replies.filter((r) => !runs.has(r.judgeRunId));
  };
  return {
    org: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(db.settings.has(where.id) ? { settings: db.settings.get(where.id) } : null)
      ),
    },
    assessment: {
      findMany: vi.fn(
        ({
          where,
          take,
          orderBy,
        }: {
          where: Record<string, unknown>;
          take?: number;
          orderBy?: { createdAt: 'asc' };
        }) => {
          if (JSON.stringify(orderBy) !== JSON.stringify({ createdAt: 'asc' })) {
            throw new Error('fake models only `orderBy: { createdAt: asc }`');
          }
          const rows = expired(where)
            .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
            .slice(0, take);
          return Promise.resolve(rows.map((a) => ({ id: a.id })));
        }
      ),
      deleteMany: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        const hit = expired(where);
        dropAssessments(new Set(hit.map((a) => a.id)));
        return Promise.resolve({ count: hit.length });
      }),
    },
    content: {
      deleteMany: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        allowed(where, ['orgId', 'createdAt', 'assessments']);
        if (JSON.stringify(where.assessments) !== JSON.stringify({ none: {} })) {
          throw new Error('fake models only `assessments: { none: {} }`');
        }
        const hit = db.contents.filter(
          (c) =>
            c.orgId === where.orgId &&
            before(c.createdAt, where.createdAt) &&
            !db.assessments.some((a) => a.contentId === c.id)
        );
        const ids = new Set(hit.map((c) => c.id));
        db.contents = db.contents.filter((c) => !ids.has(c.id));
        return Promise.resolve({ count: hit.length });
      }),
    },
    judgeReply: {
      deleteMany: vi.fn(
        ({
          where,
        }: {
          where: Record<string, unknown> & {
            judgeRun?: { assessment?: unknown };
          };
        }) => {
          allowed(where, ['orgId', 'createdAt', 'judgeRun']);
          const filter = where.judgeRun?.assessment;
          if (Object.keys(where.judgeRun ?? {}).join() !== 'assessment' || !filter) {
            throw new Error('fake models only `judgeRun: { assessment }`');
          }
          const hit = db.replies.filter((reply) => {
            const run = db.judgeRuns.find((r) => r.id === reply.judgeRunId);
            const parent = db.assessments.find((a) => a.id === run?.assessmentId);
            return (
              reply.orgId === where.orgId &&
              before(reply.createdAt, where.createdAt) &&
              parent !== undefined &&
              settled(parent, filter)
            );
          });
          const ids = new Set(hit.map((r) => r.id));
          db.replies = db.replies.filter((r) => !ids.has(r.id));
          return Promise.resolve({ count: hit.length });
        }
      ),
    },
  };
});
vi.mock('@/lib/db/client', () => ({ prisma: fakePrisma }));
/** The report PDFs storage holds, by assessment; `refuse` makes deleting one's fail. */
const pdfs = vi.hoisted(() => ({
  held: new Set<string>(),
  refuse: new Set<string>(),
  deletes: [] as string[],
  /** Whether storage can cache PDFs at all (`reportPdfStore`). */
  caching: true,
}));
vi.mock('@/lib/app/reports/pdf/cache', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/app/reports/pdf/cache')>();
  const deleteReportPdfs = vi.fn((orgId: string, id: string) => {
    pdfs.deletes.push(id);
    if (pdfs.refuse.has(id)) {
      return Promise.reject(new real.ReportPdfCleanupError(real.reportPdfFolder(orgId, id)));
    }
    pdfs.held.delete(id);
    return Promise.resolve();
  });
  return {
    ...real,
    reportPdfStore: vi.fn(() => (pdfs.caching ? { name: 'fake-store' } : null)),
    deleteReportPdfs,
    sweepReportPdfs: vi.fn(async (orgId: string, ids: string[]) => {
      for (const id of ids) await deleteReportPdfs(orgId, id).catch(() => undefined);
    }),
  };
});
vi.mock('@/lib/tenancy/context', () => ({
  requireOrgId: () => {
    if (!db.orgId) throw new Error('no tenant context');
    return db.orgId;
  },
}));

import { purgeExpiredContent, PURGE_BATCH } from '@/lib/app/retention/purge';

const WS = 'cmorg000000000000000team1';
const OTHER = 'cmorg0000000000000000org2';
const NOW = new Date('2026-11-15T12:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

let seq = 0;
/** One content row, one assessment on it, one judge run and its reply. */
function piece(
  orgId: string,
  ageDays: number,
  status: Status = 'COMPLETED',
  leaseExpiresAt: Date | null = null,
  completedAt: Date | null = daysAgo(ageDays)
) {
  const n = ++seq;
  const content = { id: `c${n}`, orgId, createdAt: daysAgo(ageDays) };
  const assessment = {
    id: `a${n}`,
    orgId,
    contentId: content.id,
    status,
    leaseExpiresAt,
    completedAt,
    createdAt: daysAgo(ageDays),
  };
  const run = { id: `r${n}`, orgId, assessmentId: assessment.id };
  const reply = { id: `p${n}`, orgId, judgeRunId: run.id, createdAt: daysAgo(ageDays) };
  db.contents.push(content);
  db.assessments.push(assessment);
  db.judgeRuns.push(run);
  db.replies.push(reply);
  return { content, assessment, run, reply };
}

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();
const snapshot = () =>
  structuredClone({ c: db.contents, a: db.assessments, r: db.judgeRuns, p: db.replies });

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  db.settings.clear();
  db.contents = [];
  db.assessments = [];
  db.judgeRuns = [];
  db.replies = [];
  db.orgId = WS;
  pdfs.held.clear();
  pdfs.refuse.clear();
  pdfs.deletes = [];
  pdfs.caching = true;
});

describe('with a content window', () => {
  beforeEach(() => {
    db.settings.set(WS, { quotas: { monthlyBudgetUsd: 10 }, app: { retention: { days: 90 } } });
    db.settings.set(OTHER, null);
  });

  it('deletes content and assessments past the window, keeping those inside it', async () => {
    piece(WS, 120);
    piece(WS, 400, 'FAILED');
    const recent = piece(WS, 10);
    const edge = piece(WS, 89);

    const result = await purgeExpiredContent(NOW);

    expect(result).toMatchObject({ assessments: 2, contents: 2 });
    expect(ids(db.assessments)).toEqual(ids([recent.assessment, edge.assessment]));
    expect(ids(db.contents)).toEqual(ids([recent.content, edge.content]));
    // Their judge runs and replies went with them (the cascade).
    expect(ids(db.judgeRuns)).toEqual(ids([recent.run, edge.run]));
  });

  it('a second pass changes nothing', async () => {
    piece(WS, 120);
    piece(WS, 45);
    piece(WS, 10);
    await purgeExpiredContent(NOW);
    const after = snapshot();

    const second = await purgeExpiredContent(NOW);

    expect(second).toEqual({ assessments: 0, contents: 0, replies: 0 });
    expect(snapshot()).toEqual(after);
  });

  it('keeps old content that a newer assessment is still on, until that one ages out', async () => {
    const old = piece(WS, 120);
    // A second assessment of the same text, inside the window.
    db.assessments.push({
      id: 'a-new',
      orgId: WS,
      contentId: old.content.id,
      status: 'COMPLETED',
      leaseExpiresAt: null,
      completedAt: daysAgo(5),
      createdAt: daysAgo(5),
    });

    const result = await purgeExpiredContent(NOW);

    expect(result).toMatchObject({ assessments: 1, contents: 0 });
    expect(ids(db.contents)).toEqual([old.content.id]);
    expect(ids(db.assessments)).toEqual(['a-new']);
  });

  it('leaves a queued or running assessment past the window, its content and its replies', async () => {
    const queued = piece(WS, 120, 'QUEUED');
    const running = piece(WS, 120, 'RUNNING');
    piece(WS, 120, 'CANCELLED');

    await purgeExpiredContent(NOW);

    expect(ids(db.assessments)).toEqual(ids([queued.assessment, running.assessment]));
    expect(ids(db.contents)).toEqual(ids([queued.content, running.content]));
    // A re-drive reads its finished judges' replies back.
    expect(ids(db.replies)).toEqual(ids([queued.reply, running.reply]));
  });

  it('leaves a cancelled assessment whose judges may still land or that is not charged yet, by the cancel time not the lease', async () => {
    const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
    // Cancelled ten minutes ago: its lease has lapsed (a cancelled run stops
    // renewing it), but a judge can still be out.
    const recent = piece(WS, 120, 'CANCELLED', minutesAgo(8), minutesAgo(10));
    // Cancelled two hours ago, lease lapsed and still set: past any judge's
    // timeout, but the recovery job has not charged it yet (t-58).
    const uncharged = piece(WS, 120, 'CANCELLED', minutesAgo(118), minutesAgo(120));
    // Cancelled more than a day ago: the recovery job never will.
    piece(WS, 120, 'CANCELLED', minutesAgo(26 * 60 - 2), minutesAgo(26 * 60));
    // Every judge landed: `freePlace` cleared the lease.
    piece(WS, 120, 'CANCELLED', null, minutesAgo(10));

    const result = await purgeExpiredContent(NOW);

    expect(result).toMatchObject({ assessments: 2, contents: 2 });
    expect(ids(db.assessments)).toEqual(ids([recent.assessment, uncharged.assessment]));
    expect(ids(db.contents)).toEqual(ids([recent.content, uncharged.content]));
    expect(ids(db.replies)).toEqual(ids([recent.reply, uncharged.reply]));
  });

  it("deletes a purged assessment's cached report PDFs, and only those", async () => {
    const old = piece(WS, 120);
    const recent = piece(WS, 10);
    pdfs.held.add(old.assessment.id);
    pdfs.held.add(recent.assessment.id);

    await purgeExpiredContent(NOW);

    expect([...pdfs.held]).toEqual([recent.assessment.id]);
    // Before the row and swept once more after it (a render may have raced the purge).
    expect(pdfs.deletes).toEqual([old.assessment.id, old.assessment.id]);
  });

  it('keeps an assessment whose PDFs storage would not delete, for the next pass', async () => {
    const stuck = piece(WS, 120);
    piece(WS, 200);
    pdfs.held.add(stuck.assessment.id);
    pdfs.refuse.add(stuck.assessment.id);

    const result = await purgeExpiredContent(NOW);

    expect(result.assessments).toBe(1);
    expect(ids(db.assessments)).toEqual([stuck.assessment.id]);
    // Its text stays too: the assessment still uses it.
    expect(ids(db.contents)).toEqual([stuck.content.id]);

    // Once storage recovers, the next pass finishes it.
    pdfs.refuse.clear();
    await purgeExpiredContent(NOW);
    expect(db.assessments).toEqual([]);
    expect(pdfs.held.size).toBe(0);
  });

  it('works through more expired assessments than one batch holds', async () => {
    const many = Array.from({ length: PURGE_BATCH + 3 }, () => piece(WS, 120));
    const recent = piece(WS, 10);

    const result = await purgeExpiredContent(NOW);

    expect(result.assessments).toBe(many.length);
    expect(ids(db.assessments)).toEqual([recent.assessment.id]);
    // A full batch, then the three left over.
    expect(fakePrisma.assessment.findMany).toHaveBeenCalledTimes(2);
  });

  it('ends the pass when storage refuses a whole batch, keeping every row', async () => {
    const a = piece(WS, 120);
    const b = piece(WS, 130);
    pdfs.refuse.add(a.assessment.id);
    pdfs.refuse.add(b.assessment.id);

    const result = await purgeExpiredContent(NOW);

    expect(result.assessments).toBe(0);
    expect(ids(db.assessments)).toEqual(ids([a.assessment, b.assessment]));
    expect(fakePrisma.assessment.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes in one statement, touching no storage, where nothing can be cached', async () => {
    pdfs.caching = false;
    piece(WS, 120);
    const recent = piece(WS, 10);

    const result = await purgeExpiredContent(NOW);

    expect(result.assessments).toBe(1);
    expect(ids(db.assessments)).toEqual([recent.assessment.id]);
    expect(fakePrisma.assessment.findMany).not.toHaveBeenCalled();
    expect(pdfs.deletes).toEqual([]);
  });

  it('touches no other workspace', async () => {
    const theirs = piece(OTHER, 400);
    piece(WS, 400);

    await purgeExpiredContent(NOW);

    expect(ids(db.assessments)).toEqual([theirs.assessment.id]);
    expect(ids(db.replies)).toEqual([theirs.reply.id]);
  });
});

describe('judge replies', () => {
  it('go after 30 days by default, even inside the content window, keeping the runs', async () => {
    db.settings.set(WS, { app: { retention: { days: 365 } } });
    const month = piece(WS, 45);
    const fresh = piece(WS, 29);

    const result = await purgeExpiredContent(NOW);

    expect(result).toEqual({ assessments: 0, contents: 0, replies: 1 });
    expect(ids(db.replies)).toEqual([fresh.reply.id]);
    expect(ids(db.judgeRuns)).toEqual(ids([month.run, fresh.run]));
    expect(db.assessments).toHaveLength(2);
  });

  it('follow the workspace’s own reply window', async () => {
    db.settings.set(WS, { app: { judgeReplyRetention: { days: 7 } } });
    piece(WS, 10);
    const week = piece(WS, 3);

    expect((await purgeExpiredContent(NOW)).replies).toBe(1);
    expect(ids(db.replies)).toEqual([week.reply.id]);
  });

  it('an unreadable reply window deletes no reply, rather than falling back to 30 days', async () => {
    db.settings.set(WS, { app: { judgeReplyRetention: { days: 400 } } });
    const old = piece(WS, 45);

    expect((await purgeExpiredContent(NOW)).replies).toBe(0);
    expect(ids(db.replies)).toEqual([old.reply.id]);
    expect(fakePrisma.judgeReply.deleteMany).not.toHaveBeenCalled();
  });

  it("keep a cancelled run's replies while its judges may still land", async () => {
    const recent = new Date(NOW.getTime() - 10 * 60_000);
    const inFlight = piece(WS, 45, 'CANCELLED', recent, recent);
    piece(WS, 45, 'CANCELLED', null, recent);

    expect((await purgeExpiredContent(NOW)).replies).toBe(1);
    expect(ids(db.replies)).toEqual([inFlight.reply.id]);
  });

  it('a longer reply window keeps a reply the default would have taken', async () => {
    db.settings.set(WS, { app: { judgeReplyRetention: { days: 90 } } });
    const month = piece(WS, 45);

    expect((await purgeExpiredContent(NOW)).replies).toBe(0);
    expect(ids(db.replies)).toEqual([month.reply.id]);
  });
});

describe('with no content window', () => {
  it('keeps every content row and assessment, deleting only replies past 30 days', async () => {
    db.settings.set(WS, { quotas: { monthlyBudgetUsd: 10 } });
    const ancient = piece(WS, 2000);
    const month = piece(WS, 31);
    const fresh = piece(WS, 3);

    const result = await purgeExpiredContent(NOW);

    expect(result).toEqual({ assessments: 0, contents: 0, replies: 2 });
    expect(ids(db.contents)).toEqual(ids([ancient.content, month.content, fresh.content]));
    expect(db.assessments).toHaveLength(3);
    expect(ids(db.replies)).toEqual([fresh.reply.id]);
    expect(fakePrisma.assessment.deleteMany).not.toHaveBeenCalled();
    expect(fakePrisma.content.deleteMany).not.toHaveBeenCalled();
  });

  it('reads an unreadable window as none, deleting no content', async () => {
    db.settings.set(WS, { app: { retention: { days: -1 } } });
    piece(WS, 400);

    await purgeExpiredContent(NOW);

    expect(db.assessments).toHaveLength(1);
    expect(db.contents).toHaveLength(1);
  });

  it('a workspace whose org row is gone keeps its content and uses the default reply window', async () => {
    const old = piece(WS, 400);
    const fresh = piece(WS, 3);

    await purgeExpiredContent(NOW);

    expect(ids(db.assessments)).toEqual(ids([old.assessment, fresh.assessment]));
    expect(ids(db.replies)).toEqual([fresh.reply.id]);
  });
});
