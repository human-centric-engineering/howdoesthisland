/**
 * The calibration set: cases with the results a careful reader expects (t-36).
 *
 * The set is `lib/app/frameworks/howdoesthisland/data/eval-<version>.json`,
 * brought up from the prototype's 0.4.0 set to model 0.5.1 (D9). This module
 * is what the runner (t-37) reads it through: the shape, checked by Zod, and
 * the two checks that need the model beside it:
 *
 * - {@link caseContext}: the context a case is scored with, in the shape
 *   the engine's `parseContext` takes. The runner must use it, not a port of
 *   the prototype's `caseCtx()`, which dropped the case's culture.
 * - {@link danglingReferences}: every id a case names is one the model has,
 *   so a run cannot fail part way through on a typo. The context goes
 *   through the engine's own `parseContext` (culture on), so it is refused
 *   exactly when a run would refuse it; the expectations' ids are checked
 *   against the engine's model index. It supersedes
 *   `prototype/tools/validate_refs.py`, which reads only the 0.4.0 fields.
 * - {@link judgesChecked}: which of the nine judges a case says something
 *   about, so the set can be held to at least six cases per judge.
 *
 * How each expectation is scored is in the set's `meta.how_to_use`: bands
 * are the three the 0.4.0 set used (`band3` in the engine), a group's band
 * reads its group score, and a key dimension passes at 1 or below (`low`) or
 * 3 or above (`high`) on the 0–4 scale.
 */
import { z } from 'zod';
import type { EngineModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import { GLOBAL_CULTURE, parseContext } from '@/lib/app/frameworks/howdoesthisland/engine/context';
import type { band3 } from '@/lib/app/frameworks/howdoesthisland/engine/text';
import {
  HOWDOESTHISLAND_JUDGE_SLOTS,
  type HowDoesThisLandJudgeSlot,
} from '@/lib/app/frameworks/howdoesthisland/judge-slots';

export const BANDS = ['low', 'mid', 'high'] as const;
export const bandSchema = z.enum(BANDS);
export type Band = z.infer<typeof bandSchema>;
/** The runner scores with the engine's `band3`; this fails to compile if the two sets of bands part. */
type SameBands<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const bandsMatchEngine: SameBands<Band, ReturnType<typeof band3>> = true;
void bandsMatchEngine;

const id = z.string().min(1);
/** A list of ids, none repeated: a repeat would count one hit twice. */
const ids = z.array(id).refine((list) => new Set(list).size === list.length, {
  error: 'An id is listed twice',
});

/** The groups a judge scores as a band and key dimensions. */
export const CALIBRATED_GROUPS = ['craft', 'audience', 'culture'] as const;
export type CalibratedGroup = (typeof CALIBRATED_GROUPS)[number];

const groupExpectationSchema = z
  .strictObject({
    band: bandSchema,
    /** Dimensions of the group expected to score 1 or below. */
    low: ids.optional(),
    /** Dimensions of the group expected to score 3 or above. */
    high: ids.optional(),
  })
  .refine((g) => !(g.low ?? []).some((d) => g.high?.includes(d)), {
    error: 'A dimension cannot be expected both low and high',
  });
export type GroupExpectation = z.infer<typeof groupExpectationSchema>;

const LEVER_STATUSES = ['present', 'misused', 'absent'] as const;
export type ExpectedLeverStatus = (typeof LEVER_STATUSES)[number];

const leverExpectationSchema = z
  .strictObject({
    present: ids.optional(),
    misused: ids.optional(),
    absent: ids.optional(),
  })
  .refine((l) => LEVER_STATUSES.some((s) => (l[s]?.length ?? 0) > 0), {
    error: 'A lever expectation names at least one lever',
  })
  .refine(
    (l) => {
      const named = LEVER_STATUSES.flatMap((s) => l[s] ?? []);
      return new Set(named).size === named.length;
    },
    { error: 'A lever can be expected in one status only' }
  );

export const expectationSchema = z
  .strictObject({
    appeals: z.strictObject({
      ethos: bandSchema,
      pathos: bandSchema,
      logos: bandSchema,
      kairos: bandSchema,
    }),
    overall: bandSchema,
    flags_present: ids,
    flags_absent: ids,
    recommend_dimensions: ids,
    balance_rules: ids,
    /**
     * Checked against the lenses judge's primary duty. Null, as 0.4.0 has it,
     * means no one duty is expected, and is not checked.
     */
    primary_duty: id.nullable().optional(),
    groups: z
      .strictObject({
        craft: groupExpectationSchema.optional(),
        audience: groupExpectationSchema.optional(),
        culture: groupExpectationSchema.optional(),
      })
      .optional(),
    /** Checked against the influence judge's lever statuses. */
    levers: leverExpectationSchema.optional(),
  })
  .refine((e) => !e.flags_present.some((f) => e.flags_absent.includes(f)), {
    error: 'A flag cannot be expected both present and absent',
  });
export type Expectation = z.infer<typeof expectationSchema>;

export const calibrationCaseSchema = z
  .strictObject({
    id,
    title: z.string().min(1),
    content_type: id,
    /**
     * Who reads it: `archetype`, `role` and any audience modifier, by id.
     * Empty is a general reader. {@link caseContext} sorts them into the
     * engine's context.
     */
    audience: z.record(z.string(), id),
    /** Reader and writer culture, by country id or `global`. */
    culture: z.strictObject({ reader: id.optional(), writer: id.optional() }).optional(),
    text: z.string().min(1),
    expect: expectationSchema,
    notes: z.string(),
  })
  .refine(
    (c) =>
      !c.expect.groups?.culture ||
      (c.culture?.reader !== undefined && c.culture.reader !== GLOBAL_CULTURE),
    {
      // `global` is the profile the engine uses when no reader is named.
      error: 'A culture expectation needs a reader country to judge against',
      path: ['culture', 'reader'],
    }
  );
export type CalibrationCase = z.infer<typeof calibrationCaseSchema>;

export const calibrationSetSchema = z.strictObject({
  meta: z.looseObject({
    name: z.string().min(1),
    /** The set's own version. */
    version: z.string().min(1),
    /** The framework model version the set is written against. */
    model: z.string().min(1),
    bands: z.strictObject({ low: z.string(), mid: z.string(), high: z.string() }),
    how_to_use: z.string().min(1),
  }),
  cases: z
    .array(calibrationCaseSchema)
    .min(1)
    .refine((cases) => new Set(cases.map((c) => c.id)).size === cases.length, {
      error: 'Case ids must be unique',
    }),
});
export type CalibrationSet = z.infer<typeof calibrationSetSchema>;

/** The nine judges, and whether a case carries an expectation each one is checked against. */
const CHECKS: Readonly<Record<HowDoesThisLandJudgeSlot, (e: Expectation) => boolean>> = {
  judge_ethos: () => true,
  judge_pathos: () => true,
  judge_logos: () => true,
  judge_kairos: () => true,
  judge_lenses: (e) => typeof e.primary_duty === 'string',
  judge_craft: (e) => e.groups?.craft !== undefined,
  judge_audience: (e) => e.groups?.audience !== undefined,
  judge_culture: (e) => e.groups?.culture !== undefined,
  judge_influence: (e) => e.levers !== undefined,
};

/** The judges a case says something about. */
export function judgesChecked(c: CalibrationCase): HowDoesThisLandJudgeSlot[] {
  return HOWDOESTHISLAND_JUDGE_SLOTS.filter((slot) => CHECKS[slot](c.expect));
}

/** Number of cases that check each judge, for every judge. */
export function judgeCoverage(set: CalibrationSet): Map<HowDoesThisLandJudgeSlot, number> {
  const counts = new Map(HOWDOESTHISLAND_JUDGE_SLOTS.map((slot) => [slot, 0]));
  for (const c of set.cases) {
    for (const slot of judgesChecked(c)) counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  return counts;
}

/** What the engine's `parseContext` takes for a case: archetype and role lifted out of `audience`. */
export interface CaseContextInput {
  contentType: string;
  archetype?: string;
  role?: string;
  audience: Record<string, string>;
  culture?: { reader?: string; writer?: string };
}

/** The context a case is scored with. Culture is passed through, so run with the culture switch on. */
export function caseContext(c: CalibrationCase): CaseContextInput {
  const { archetype, role, ...audience } = c.audience;
  return {
    contentType: c.content_type,
    ...(archetype !== undefined ? { archetype } : {}),
    ...(role !== undefined ? { role } : {}),
    audience,
    ...(c.culture ? { culture: c.culture } : {}),
  };
}

/**
 * Every reference in the set the model does not have: a context problem as
 * `<case>.context.<path>: <message>`, an expectation's id as
 * `<case>.<path>: '<id>'`. Empty when the set can be run against the model.
 */
export function danglingReferences(set: CalibrationSet, m: EngineModel): string[] {
  const out: string[] = [];
  const balance = new Set(m.data.balance_rules.map((b) => b.id));
  const duties = new Set(m.FN.map((d) => d.id));

  for (const c of set.cases) {
    const miss = (path: string, ref: string, ok: boolean) => {
      if (!ok) out.push(`${c.id}.${path}: '${ref}'`);
    };
    const e = c.expect;

    const ctx = parseContext(m, caseContext(c), true);
    if (!ctx.ok) {
      for (const issue of ctx.issues) out.push(`${c.id}.context.${issue.path}: ${issue.message}`);
    }

    for (const f of [...e.flags_present, ...e.flags_absent]) miss('flags', f, m.FLAG.has(f));
    for (const d of e.recommend_dimensions) miss('recommend_dimensions', d, m.DIM.has(d));
    for (const b of e.balance_rules) miss('balance_rules', b, balance.has(b));
    if (e.primary_duty) miss('primary_duty', e.primary_duty, duties.has(e.primary_duty));

    for (const group of CALIBRATED_GROUPS) {
      const g = e.groups?.[group];
      if (!g) continue;
      for (const d of [...(g.low ?? []), ...(g.high ?? [])]) {
        const dim = m.DIM.get(d);
        miss(`groups.${group}`, d, dim !== undefined && 'group' in dim && dim.group === group);
      }
    }

    for (const status of LEVER_STATUSES) {
      for (const l of e.levers?.[status] ?? []) miss(`levers.${status}`, l, m.LEVER.has(l));
    }
  }
  return out;
}
