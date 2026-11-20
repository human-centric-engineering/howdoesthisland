/**
 * An in-memory `assessment` / `judgeRun` / `judgeReply` store for the
 * assessment job's tests
 * (B9: a small stateful fake proves a chain no call-assertion can).
 *
 * Implements only what `lib/app/assessments/` asks of Prisma, with the same
 * semantics: `where` with equality, `null`, `in`, `not`, `gt`, `lt`, `gte` and
 * `OR`; `attempts: { increment }`; `updateMany` answering a count; the
 * `assessmentId_judge` upsert; `$transaction(fn)` running `fn` on the same
 * store. A `findUnique` returns the whole row with its `content`,
 * `judgeRuns` and `frameworkVersion` (always `howdoesthisland@0.5.1`),
 * whatever it selects: the code under test reads what it asked for, and
 * extra fields cannot make a test pass.
 *
 * For the API (t-24): `findMany` honours `orderBy: { createdAt }` (or a list
 * led by it), `skip` and `take`; `assessment.delete` cascades to its judge
 * runs; `content.deleteMany` honours `assessments: { none: {} }`. Every
 * write is a `vi.fn`, so a test can assert that none was made.
 *
 * For retention (t-26): a judge run's reply is its own row in `replies`,
 * attached to the run as `reply` when an assessment is read, and gone with
 * the run when the run goes. `seed()` takes a run's `output` and `dropped`
 * and stores them as its reply, as the migration copied existing ones.
 *
 * For the running places (t-28): `assessmentPlace` rows in `places`, with
 * `count`, `create`, `updateMany` and `deleteMany` (`lte` honoured).
 * `$transaction` runs one transaction at a time, which is what Serializable
 * guarantees the code under test (a count and the write it decides stand or
 * fall together), so N+1 concurrent claimers cannot all see a free place.
 */
import { vi } from 'vitest';

export type Row = Record<string, unknown>;

type Condition =
  | null
  | string
  | number
  | Date
  | {
      in?: unknown[];
      not?: unknown;
      gt?: Date | number;
      lt?: Date | number;
      lte?: Date | number;
      gte?: number;
    };

function matchesValue(value: unknown, cond: Condition | undefined): boolean {
  if (cond === undefined) return true;
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
  if (typeof cond !== 'object') return value === cond;
  if (cond.in && !cond.in.includes(value)) return false;
  if ('not' in cond && value === cond.not) return false;
  const n = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : null;
  const num = (v: Date | number) => (v instanceof Date ? v.getTime() : v);
  if (cond.gt !== undefined && (n === null || !(n > num(cond.gt)))) return false;
  if (cond.lt !== undefined && (n === null || !(n < num(cond.lt)))) return false;
  if (cond.lte !== undefined && (n === null || !(n <= num(cond.lte)))) return false;
  if (cond.gte !== undefined && (n === null || !(n >= cond.gte))) return false;
  return true;
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    return matchesValue(row[key], cond as Condition);
  });
}

function apply(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      row[key] = Number(row[key] ?? 0) + Number((value as { increment: number }).increment);
    } else {
      row[key] = value;
    }
  }
  row.updatedAt = new Date();
}

export function createFakeDb() {
  const assessments: Row[] = [];
  const contents: Row[] = [];
  const judgeRuns: Row[] = [];
  const replies: Row[] = [];
  const places: Row[] = [];
  let seq = 0;
  /** The tail of the transaction queue: each waits for the one before. */
  let txQueue: Promise<unknown> = Promise.resolve();

  /** Remove an assessment's judge runs, and their replies (the cascade). */
  const dropRunsOf = (assessmentId: unknown) => {
    for (let i = judgeRuns.length - 1; i >= 0; i -= 1) {
      const run = judgeRuns[i];
      if (run?.assessmentId !== assessmentId) continue;
      judgeRuns.splice(i, 1);
      for (let j = replies.length - 1; j >= 0; j -= 1) {
        if (replies[j]?.judgeRunId === run.id) replies.splice(j, 1);
      }
    }
  };

  const withRelations = (row: Row): Row => ({
    ...row,
    content: contents.find((c) => c.id === row.contentId) ?? null,
    judgeRuns: judgeRuns
      .filter((r) => r.assessmentId === row.id)
      .map((r) => ({ ...r, reply: replies.find((p) => p.judgeRunId === r.id) ?? null })),
    frameworkVersion: { version: '0.5.1', framework: { slug: 'howdoesthisland' } },
  });

  type Order = { createdAt?: 'asc' | 'desc' } | { createdAt?: 'asc' | 'desc' }[];
  const ordered = (rows: Row[], orderBy?: Order): Row[] => {
    const first = Array.isArray(orderBy) ? orderBy[0] : orderBy;
    if (!first?.createdAt) return rows;
    const dir = first.createdAt === 'desc' ? -1 : 1;
    return [...rows].sort(
      (x, y) => dir * ((x.createdAt as Date).getTime() - (y.createdAt as Date).getTime())
    );
  };

  const db = {
    assessment: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const row = assessments.find((a) => matches(a, where));
        return row ? withRelations(row) : null;
      }),
      findMany: vi.fn(
        async ({
          where,
          take,
          skip,
          orderBy,
        }: {
          where?: Row;
          take?: number;
          skip?: number;
          orderBy?: Order;
        }) => {
          const rows = ordered(
            assessments.filter((a) => matches(a, where)),
            orderBy
          );
          const from = skip ?? 0;
          return rows.slice(from, from + (take ?? rows.length)).map(withRelations);
        }
      ),
      /** The first match, oldest first (the only order the code under test asks for). */
      findFirst: vi.fn(async ({ where }: { where?: Row }) => {
        const rows = assessments
          .filter((a) => matches(a, where))
          .sort((x, y) => (x.createdAt as Date).getTime() - (y.createdAt as Date).getTime());
        return rows[0] ? { ...rows[0] } : null;
      }),
      count: vi.fn(
        async ({ where }: { where?: Row }) => assessments.filter((a) => matches(a, where)).length
      ),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = assessments.find((a) => matches(a, where));
        if (!row) throw new Error('record not found');
        apply(row, data);
        return { ...row };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = assessments.filter((a) => matches(a, where));
        for (const row of rows) apply(row, data);
        return { count: rows.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const gone = assessments.filter((a) => matches(a, where));
        for (const row of gone) {
          assessments.splice(assessments.indexOf(row), 1);
          dropRunsOf(row.id);
        }
        return { count: gone.length };
      }),
      delete: vi.fn(async ({ where }: { where: Row }) => {
        const index = assessments.findIndex((a) => matches(a, where));
        if (index < 0) throw new Error('record not found');
        const [row] = assessments.splice(index, 1);
        dropRunsOf(row?.id);
        return { ...row };
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        seq += 1;
        const row: Row = {
          id: `assessment-${seq}`,
          status: 'QUEUED',
          attempts: 0,
          leaseToken: null,
          leaseExpiresAt: null,
          startedAt: null,
          completedAt: null,
          result: null,
          overall: null,
          band: null,
          error: null,
          errorCode: null,
          errorDetails: null,
          costUsd: 0,
          ...data,
          createdAt: new Date(),
        };
        assessments.push(row);
        return { id: row.id, contentId: row.contentId };
      }),
    },
    content: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        seq += 1;
        const row = { id: `content-${seq}`, ...data, createdAt: new Date() };
        contents.push(row);
        return { id: row.id };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Row & { assessments?: { none: Row } } }) => {
        const { assessments: rel, ...own } = where;
        let count = 0;
        for (let i = contents.length - 1; i >= 0; i -= 1) {
          const c = contents[i];
          if (!matches(c, own)) continue;
          if (rel && assessments.some((a) => a.contentId === c.id)) continue;
          contents.splice(i, 1);
          count += 1;
        }
        return { count };
      }),
    },
    judgeRun: {
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { assessmentId_judge: { assessmentId: string; judge: string } };
          create: Row;
          update: Row;
        }) => {
          const key = where.assessmentId_judge;
          const row = judgeRuns.find(
            (r) => r.assessmentId === key.assessmentId && r.judge === key.judge
          );
          if (row) {
            apply(row, update);
            return { ...row };
          }
          const created = {
            id: `run-${judgeRuns.length + 1}`,
            costUsd: 0,
            ...create,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          judgeRuns.push(created);
          return { ...created };
        }
      ),
    },
    judgeReply: {
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { judgeRunId: string };
          create: Row;
          update: Row;
        }) => {
          const row = replies.find((p) => p.judgeRunId === where.judgeRunId);
          if (row) {
            Object.assign(row, update);
            return { ...row };
          }
          const created = { id: `reply-${replies.length + 1}`, ...create, createdAt: new Date() };
          replies.push(created);
          return { ...created };
        }
      ),
    },
    assessmentPlace: {
      count: vi.fn(
        async ({ where }: { where?: Row }) => places.filter((p) => matches(p, where)).length
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        seq += 1;
        const row: Row = { id: `place-${seq}`, ...data, createdAt: new Date() };
        places.push(row);
        return { id: row.id };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = places.filter((p) => matches(p, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const gone = places.filter((p) => matches(p, where));
        for (const row of gone) places.splice(places.indexOf(row), 1);
        return { count: gone.length };
      }),
    },
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => {
      const run = txQueue.then(() => fn(db));
      txQueue = run.catch(() => undefined);
      return run;
    }),
  };

  /** Seed an assessment (and its content) directly. */
  function seed(over: Row = {}, runs: Row[] = []): Row {
    seq += 1;
    const content = {
      id: `content-${seq}`,
      orgId: over.orgId ?? 'org-a',
      text: 'The text.',
      title: null,
      sourceKind: 'TEXT',
      sourceUrl: null,
      fileName: null,
      wordCount: 2,
    };
    contents.push(content);
    const row: Row = {
      id: `assessment-${seq}`,
      orgId: 'org-a',
      contentId: content.id,
      frameworkVersionId: 'version-1',
      profile: 'full',
      judges: ['judge_a', 'judge_b'],
      context: { contentType: 'landing', archetype: 'buyer', audience: {} },
      status: 'QUEUED',
      attempts: 0,
      leaseToken: null,
      leaseExpiresAt: null,
      startedAt: null,
      completedAt: null,
      result: null,
      overall: null,
      band: null,
      error: null,
      errorCode: null,
      errorDetails: null,
      costUsd: 0,
      createdByUserId: 'user-1',
      createdAt: new Date(Date.now() - 60_000 + seq),
      ...over,
    };
    assessments.push(row);
    for (const { output, dropped, ...run } of runs) {
      const id = `run-${judgeRuns.length + 1}`;
      judgeRuns.push({
        id,
        assessmentId: row.id,
        costUsd: 0,
        modelName: null,
        latencyMs: null,
        errorCode: null,
        updatedAt: new Date(),
        ...run,
      });
      if (output !== undefined) {
        replies.push({
          id: `reply-${replies.length + 1}`,
          orgId: row.orgId,
          judgeRunId: id,
          output,
          dropped: dropped ?? [],
          createdAt: new Date(),
        });
      }
    }
    return row;
  }

  /** A judge run with its reply's `output` and `dropped` beside it, for assertions. */
  const withReply = (run: Row): Row => {
    const reply = replies.find((p) => p.judgeRunId === run.id);
    return reply ? { ...run, output: reply.output, dropped: reply.dropped } : { ...run };
  };

  return { db, assessments, contents, judgeRuns, replies, places, withReply, seed };
}

export type FakeDb = ReturnType<typeof createFakeDb>;
