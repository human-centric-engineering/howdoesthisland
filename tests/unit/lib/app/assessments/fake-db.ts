/**
 * An in-memory `assessment` / `judgeRun` / `judgeReply` store for the
 * assessment job's tests
 * (B9: a small stateful fake proves a chain no call-assertion can).
 *
 * Implements only what `lib/app/assessments/` asks of Prisma, with the same
 * semantics: `where` with equality, `null`, `in`, `not`, `gt`, `lt` (on a
 * string too), `gte`, `OR` and `AND`; `attempts: { increment }`; `updateMany` answering a count; the
 * `assessmentId_judge` upsert; `$transaction(fn)` running `fn` on the same
 * store. A `findUnique` or `findFirst` returns the whole row with its `content`,
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
 *
 * For the budget holds (t-50): `budgetHold` rows in `holds`, with `findMany`,
 * `create`, `updateMany` and `deleteMany`, and `$executeRaw` (the advisory
 * lock) answering `0`. One transaction at a time is also what the lock
 * guarantees the check: a request checked behind another sees its hold.
 *
 * For the credits (t-58): `aiCostLog` rows in `costRows`, with `deleteMany`, `aggregate`
 * summing `totalCostUsd` and `findMany` (`createdAt` bounds and a `metadata:
 * { path, equals }` filter honoured), and `creditEntry` rows in `credits`, with
 * `findMany`, `aggregate` summing `amount` and `createMany` honouring the `(kind,
 * reference)` unique index under `skipDuplicates`, as Postgres's ON CONFLICT
 * DO NOTHING does. `addCost()` writes a cost row as `run-judge.ts` would.
 *
 * For a project's context (t-75): `projects` (an assessment's `project`
 * relation reads it), `projectDocument` links in `projectDocuments` and
 * knowledge rows in `knowledgeDocuments`, each with `findMany`.
 *
 * For rewrites (t-81): `rewrite` rows in `rewrites`, with `findMany`
 * (`orderBy: { createdAt }` and `take`), `findFirst`, `findUnique`, `count`,
 * `create`, `update` and `updateMany`, gone with their assessment (the
 * cascade).
 *
 * For comparisons (t-87): `assessmentSet` rows in `sets` and their members in
 * `setMembers`. A set is read with its `members` (in position order, each
 * with its `assessment` or `null`), `project` and `frameworkVersion`; its
 * `deleteMany` honours `members: { none: { assessmentId: { not: null } } }`
 * and takes its members with it (the cascade). An assessment deleted leaves
 * its member with `assessmentId: null` (SET NULL).
 *
 * For verdicts (t-88): a set is made with its verdict's defaults (`WAITING`,
 * nothing held), its members' assessments carry their `content`, and it has
 * `findFirst`, `updateMany` and `aggregate` (summing `verdictHeldUsd`). Its
 * reads honour `members: { none: { assessment: { status } } }`, and
 * `assessmentSetMember.findMany` honours `set: { … }`.
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
      lt?: Date | number | string;
      lte?: Date | number;
      gte?: Date | number;
    };

function matchesValue(value: unknown, cond: Condition | undefined): boolean {
  if (cond === undefined) return true;
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
  if (typeof cond !== 'object') return value === cond;
  if (cond.in && !cond.in.includes(value)) return false;
  if ('not' in cond && value === cond.not) return false;
  // A string bound compares as text, as an id tie-break does.
  if (typeof cond.lt === 'string') return typeof value === 'string' && value < cond.lt;
  const n = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : null;
  const num = (v: Date | number | string) =>
    v instanceof Date ? v.getTime() : typeof v === 'number' ? v : NaN;
  if (cond.gt !== undefined && (n === null || !(n > num(cond.gt)))) return false;
  if (cond.lt !== undefined && (n === null || !(n < num(cond.lt)))) return false;
  if (cond.lte !== undefined && (n === null || !(n <= num(cond.lte)))) return false;
  if (cond.gte !== undefined && (n === null || !(n >= num(cond.gte)))) return false;
  return true;
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    if (key === 'AND') return (cond as Row[]).every((w) => matches(row, w));
    if (cond && typeof cond === 'object' && 'path' in cond) {
      // A JSON path filter: `{ path: [field], equals }`.
      const { path, equals } = cond as { path: string[]; equals: unknown };
      let value: unknown = row[key];
      for (const part of path) value = (value as Row | null | undefined)?.[part];
      return value === equals;
    }
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
  const holds: Row[] = [];
  const costRows: Row[] = [];
  const credits: Row[] = [];
  const projects: Row[] = [];
  const projectDocuments: Row[] = [];
  const knowledgeDocuments: Row[] = [];
  const rewrites: Row[] = [];
  const sets: Row[] = [];
  const setMembers: Row[] = [];
  let seq = 0;
  /** The tail of the transaction queue: each waits for the one before. */
  let txQueue: Promise<unknown> = Promise.resolve();

  /** Remove an assessment's judge runs, and their replies, and its rewrites (the cascade). */
  const dropRunsOf = (assessmentId: unknown) => {
    // A comparison's member keeps its place, its review gone (SET NULL).
    for (const member of setMembers) {
      if (member.assessmentId === assessmentId) member.assessmentId = null;
    }
    for (let i = rewrites.length - 1; i >= 0; i -= 1) {
      if (rewrites[i]?.assessmentId === assessmentId) rewrites.splice(i, 1);
    }
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
    project: projects.find((p) => p.id === row.projectId) ?? null,
  });

  const setWithRelations = (row: Row): Row => ({
    ...row,
    project: projects.find((p) => p.id === row.projectId) ?? null,
    frameworkVersion: { version: '0.5.1', framework: { slug: 'howdoesthisland' } },
    members: setMembers
      .filter((m) => m.setId === row.id)
      .sort((x, y) => Number(x.position) - Number(y.position))
      .map((m) => {
        const assessment = assessments.find((a) => a.id === m.assessmentId);
        return {
          ...m,
          assessment: assessment
            ? { ...assessment, content: contents.find((c) => c.id === assessment.contentId) }
            : null,
        };
      }),
  });

  /** `where` on a set, with the `members: { none }` relation filter read against its members. */
  const matchesSet = (row: Row, where: Row = {}): boolean => {
    const { members: rel, ...own } = where as Row & {
      members?: { none: Row & { assessment?: Row } };
    };
    if (!matches(row, own)) return false;
    if (!rel) return true;
    const { assessment: onReview, ...onMember } = rel.none;
    return !setMembers.some((m) => {
      if (m.setId !== row.id || !matches(m, onMember)) return false;
      if (!onReview) return true;
      const review = assessments.find((a) => a.id === m.assessmentId);
      return review !== undefined && matches(review, onReview);
    });
  };

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
        return rows[0] ? withRelations(rows[0]) : null;
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
      // What the budget check reads of the reviews in flight (t-50).
      findMany: vi.fn(async ({ where }: { where?: Row }) =>
        judgeRuns.filter((r) => matches(r, where)).map((r) => ({ ...r }))
      ),
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
    budgetHold: {
      findMany: vi.fn(async ({ where }: { where?: Row }) =>
        // `extraUsd` defaults to 0 (t-88), for a hold seeded without it.
        holds.filter((h) => matches(h, where)).map((h) => ({ extraUsd: 0, ...h }))
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        seq += 1;
        const row: Row = { id: `hold-${seq}`, createdAt: new Date(), ...data };
        holds.push(row);
        return { id: row.id };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = holds.filter((h) => matches(h, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const gone = holds.filter((h) => matches(h, where));
        for (const row of gone) holds.splice(holds.indexOf(row), 1);
        return { count: gone.length };
      }),
    },
    aiCostLog: {
      // Only `orderBy: { createdAt: 'asc' }` is asked for.
      findMany: vi.fn(async ({ where }: { where?: Row }) =>
        costRows
          .filter((r) => matches(r, where))
          .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))
      ),
      deleteMany: vi.fn(async ({ where }: { where?: Row }) => {
        const gone = costRows.filter((r) => matches(r, where));
        for (const r of gone) costRows.splice(costRows.indexOf(r), 1);
        return { count: gone.length };
      }),
      count: vi.fn(
        async ({ where }: { where?: Row }) => costRows.filter((r) => matches(r, where)).length
      ),
      aggregate: vi.fn(async ({ where }: { where?: Row }) => {
        const rows = costRows.filter((r) => matches(r, where));
        return {
          _sum: {
            totalCostUsd: rows.length
              ? rows.reduce((sum, r) => sum + Number(r.totalCostUsd), 0)
              : null,
          },
        };
      }),
    },
    // Every agent a test names exists, unless it says otherwise.
    aiAgent: {
      count: vi.fn(async () => 1),
    },
    creditEntry: {
      findMany: vi.fn(async ({ where }: { where?: Row }) =>
        credits.filter((r) => matches(r, where))
      ),
      // Only `orderBy: { createdAt: 'asc' }` is asked for: the earliest.
      findFirst: vi.fn(async ({ where }: { where?: Row }) => {
        const rows = credits.filter((r) => matches(r, where));
        return rows.sort((a, b) => Number(a.createdAt) - Number(b.createdAt))[0] ?? null;
      }),
      aggregate: vi.fn(async ({ where }: { where?: Row }) => {
        const rows = credits.filter((r) => matches(r, where));
        return {
          _sum: { amount: rows.length ? rows.reduce((sum, r) => sum + Number(r.amount), 0) : null },
        };
      }),
      createMany: vi.fn(
        async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
          let count = 0;
          for (const entry of data) {
            const taken = credits.some(
              (c) => c.kind === entry.kind && c.reference != null && c.reference === entry.reference
            );
            if (taken && skipDuplicates) continue;
            if (taken) throw new Error('Unique constraint failed on (kind, reference)');
            seq += 1;
            credits.push({ id: `credit-${seq}`, createdAt: new Date(), ...entry });
            count += 1;
          }
          return { count };
        }
      ),
    },
    project: {
      findFirst: vi.fn(
        async ({ where }: { where?: Row }) => projects.find((r) => matches(r, where)) ?? null
      ),
    },
    projectDocument: {
      findMany: vi.fn(async ({ where }: { where?: Row }) =>
        projectDocuments.filter((r) => matches(r, where)).map((r) => ({ ...r }))
      ),
    },
    rewrite: {
      findMany: vi.fn(
        async ({ where, take, orderBy }: { where?: Row; take?: number; orderBy?: Order }) => {
          const rows = ordered(
            rewrites.filter((r) => matches(r, where)),
            orderBy
          );
          return rows.slice(0, take ?? rows.length).map((r) => ({ ...r }));
        }
      ),
      findFirst: vi.fn(async ({ where }: { where?: Row }) => {
        const row = rewrites.find((r) => matches(r, where));
        return row ? { ...row } : null;
      }),
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const row = rewrites.find((r) => matches(r, where));
        return row ? { ...row } : null;
      }),
      count: vi.fn(
        async ({ where }: { where?: Row }) => rewrites.filter((r) => matches(r, where)).length
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        seq += 1;
        const row: Row = {
          id: `rewrite-${seq}`,
          status: 'RUNNING',
          draft: '',
          heldUsd: 0,
          provider: null,
          modelName: null,
          costUsd: 0,
          error: null,
          errorCode: null,
          leaseExpiresAt: null,
          createdByUserId: null,
          completedAt: null,
          createdAt: new Date(),
          ...data,
        };
        rewrites.push(row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = rewrites.find((r) => matches(r, where));
        if (!row) throw new Error('record not found');
        apply(row, data);
        return { ...row };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = rewrites.filter((r) => matches(r, where));
        for (const row of rows) apply(row, data);
        return { count: rows.length };
      }),
    },
    assessmentSet: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        seq += 1;
        const row: Row = {
          id: `set-${seq}`,
          createdAt: new Date(),
          verdictStatus: 'WAITING',
          verdict: null,
          verdictReason: null,
          verdictHeldUsd: 0,
          verdictCostUsd: 0,
          verdictModel: null,
          verdictAttempts: 0,
          verdictLeaseExpiresAt: null,
          verdictStartedAt: null,
          verdictCompletedAt: null,
          ...data,
        };
        sets.push(row);
        return { id: row.id };
      }),
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const row = sets.find((r) => matchesSet(r, where));
        return row ? setWithRelations(row) : null;
      }),
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const row = sets.find((r) => matchesSet(r, where));
        return row ? setWithRelations(row) : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = sets.filter((r) => matchesSet(r, where));
        for (const row of rows) apply(row, data);
        return { count: rows.length };
      }),
      aggregate: vi.fn(async ({ where }: { where?: Row }) => {
        const rows = sets.filter((r) => matchesSet(r, where));
        return {
          _sum: {
            verdictHeldUsd: rows.length
              ? rows.reduce((sum, r) => sum + Number(r.verdictHeldUsd), 0)
              : null,
            verdictCostUsd: rows.length
              ? rows.reduce((sum, r) => sum + Number(r.verdictCostUsd), 0)
              : null,
          },
        };
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
            sets.filter((r) => matchesSet(r, where)),
            orderBy
          );
          const from = skip ?? 0;
          return rows.slice(from, from + (take ?? rows.length)).map(setWithRelations);
        }
      ),
      count: vi.fn(
        async ({ where }: { where?: Row }) => sets.filter((r) => matchesSet(r, where)).length
      ),
      deleteMany: vi.fn(async ({ where }: { where: Row & { members?: { none: Row } } }) => {
        const { members: rel, ...own } = where;
        const gone = sets.filter(
          (r) =>
            matches(r, own) &&
            !(rel && setMembers.some((m) => m.setId === r.id && matches(m, rel.none)))
        );
        for (const row of gone) {
          sets.splice(sets.indexOf(row), 1);
          for (let i = setMembers.length - 1; i >= 0; i -= 1) {
            if (setMembers[i]?.setId === row.id) setMembers.splice(i, 1);
          }
        }
        return { count: gone.length };
      }),
    },
    assessmentSetMember: {
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        for (const member of data) {
          seq += 1;
          setMembers.push({ id: `member-${seq}`, createdAt: new Date(), ...member });
        }
        return { count: data.length };
      }),
      findMany: vi.fn(async ({ where }: { where?: Row & { set?: Row } }) => {
        const { set: onSet, ...own } = where ?? {};
        return setMembers.filter((m) => {
          if (!matches(m, own)) return false;
          const set = sets.find((r) => r.id === m.setId);
          return !onSet || (set !== undefined && matches(set, onSet));
        });
      }),
    },
    aiKnowledgeDocument: {
      findMany: vi.fn(async ({ where }: { where?: Row }) =>
        knowledgeDocuments.filter((r) => matches(r, where)).map((r) => ({ ...r }))
      ),
    },
    $executeRaw: vi.fn(async () => 0),
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

  /** A cost row as `run-judge.ts` writes it: `metadata` carries `assessmentId` or `ephemeralRun`. */
  function addCost(
    orgId: string,
    totalCostUsd: number,
    metadata: Row,
    createdAt = new Date()
  ): void {
    seq += 1;
    costRows.push({ id: `cost-${seq}`, orgId, totalCostUsd, metadata, createdAt });
  }

  /**
   * Give `orgId` credits, as an admin's grant would: by default long ago, so
   * every review a test seeds was made since charging began.
   */
  function grant(orgId: string, amount: number, createdAt = new Date(0)): void {
    seq += 1;
    credits.push({ id: `credit-${seq}`, orgId, amount, kind: 'GRANT', reference: null, createdAt });
  }

  return {
    db,
    assessments,
    contents,
    judgeRuns,
    replies,
    places,
    holds,
    costRows,
    credits,
    projects,
    projectDocuments,
    knowledgeDocuments,
    rewrites,
    sets,
    setMembers,
    withReply,
    seed,
    addCost,
    grant,
  };
}

export type FakeDb = ReturnType<typeof createFakeDb>;
