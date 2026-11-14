/**
 * An in-memory `assessment` / `judgeRun` store for the assessment job's tests
 * (B9: a small stateful fake proves a chain no call-assertion can).
 *
 * Implements only what `lib/app/assessments/` asks of Prisma, with the same
 * semantics: `where` with equality, `null`, `in`, `not`, `gt`, `lt`, `gte` and
 * `OR`; `attempts: { increment }`; `updateMany` answering a count; the
 * `assessmentId_judge` upsert; `$transaction(fn)` running `fn` on the same
 * store. A `findUnique` returns the whole row with its `content` and
 * `judgeRuns`, whatever it selects: the code under test reads what it asked
 * for, and extra fields cannot make a test pass.
 */
import { vi } from 'vitest';

export type Row = Record<string, unknown>;

type Condition =
  | null
  | string
  | number
  | Date
  | { in?: unknown[]; not?: unknown; gt?: Date | number; lt?: Date | number; gte?: number };

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
  let seq = 0;

  const withRelations = (row: Row): Row => ({
    ...row,
    content: contents.find((c) => c.id === row.contentId) ?? null,
    judgeRuns: judgeRuns.filter((r) => r.assessmentId === row.id),
  });

  const db = {
    assessment: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const row = assessments.find((a) => matches(a, where));
        return row ? withRelations(row) : null;
      }),
      findMany: vi.fn(async ({ where, take }: { where?: Row; take?: number }) => {
        const rows = assessments.filter((a) => matches(a, where));
        return rows.slice(0, take ?? rows.length).map((r) => ({ ...r }));
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
      create: vi.fn(async ({ data }: { data: Row }) => {
        const { content, frameworkVersion, ...rest } = data as Row & {
          content: { create: Row };
          frameworkVersion: { connect: { id: string } };
        };
        seq += 1;
        const contentRow = { id: `content-${seq}`, ...content.create, createdAt: new Date() };
        contents.push(contentRow);
        const row: Row = {
          id: `assessment-${seq}`,
          status: 'QUEUED',
          attempts: 0,
          leaseToken: null,
          leaseExpiresAt: null,
          startedAt: null,
          completedAt: null,
          result: null,
          error: null,
          costUsd: 0,
          ...rest,
          frameworkVersionId: frameworkVersion.connect.id,
          contentId: contentRow.id,
          createdAt: new Date(),
        };
        assessments.push(row);
        return { id: row.id, contentId: row.contentId };
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
          const created = { id: `run-${judgeRuns.length + 1}`, costUsd: 0, ...create };
          judgeRuns.push(created);
          return { ...created };
        }
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };

  /** Seed an assessment (and its content) directly. */
  function seed(over: Row = {}, runs: Row[] = []): Row {
    seq += 1;
    const content = { id: `content-${seq}`, text: 'The text.', sourceUrl: null };
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
      costUsd: 0,
      createdByUserId: 'user-1',
      createdAt: new Date(Date.now() - 60_000 + seq),
      ...over,
    };
    assessments.push(row);
    for (const run of runs) {
      judgeRuns.push({
        id: `run-${judgeRuns.length + 1}`,
        assessmentId: row.id,
        costUsd: 0,
        ...run,
      });
    }
    return row;
  }

  return { db, assessments, contents, judgeRuns, seed };
}

export type FakeDb = ReturnType<typeof createFakeDb>;
