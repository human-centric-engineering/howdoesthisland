/**
 * The reply each judge is asked for, as a schema (t-18, plan §8.3).
 *
 * There are three shapes, as there are three prompts: an **appeal** judge
 * (the four appeals and the lenses), an **extra** group (craft, audience,
 * culture) and the **influence** panel. Each is a Zod schema built from the
 * version's own ids, so a reply cannot name a dimension, move, flag,
 * perspective or lever the version does not have, and its JSON Schema form
 * ({@link outputSchema}) is what the provider is held to in strict mode.
 *
 * **OpenAI's strict mode accepts a subset of JSON Schema.** Every property
 * must be required, every object closed (`additionalProperties: false`), and
 * only some keywords are honoured. So there is no optional field (a judge
 * with nothing to say sends an empty list), no numeric range (a score is a
 * number, and the post-validator clamps it), and a fixed value is a
 * one-member `enum`, not `const`. `judge-schemas.test.ts` checks every
 * schema against those rules.
 *
 * The schema is a request, not a guarantee: a provider without strict mode
 * ignores it, so every reply still goes through `validateJudgeReply()`.
 */
import { z } from 'zod';
import { CULTURE_GROUP, type EngineModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import { judgeFor } from '@/lib/app/frameworks/howdoesthisland/engine/prompts';

export type JudgeShape = 'appeal' | 'extra' | 'influence';

export const POLARITIES = ['strength', 'weakness'] as const;
export const IMPACTS = ['high', 'medium', 'low'] as const;
export const LEVER_STATUSES = ['present', 'absent', 'misused', 'not_applicable'] as const;

/** Which of the three replies a slot's judge gives. */
export function shapeOf(m: EngineModel, slot: string): JudgeShape {
  const g = judgeFor(m, slot).appeal;
  return g === 'influence' ? 'influence' : m.GROUP.has(g) ? 'extra' : 'appeal';
}

/** The ids a judge's reply may use, read from the version. */
export interface JudgeIds {
  group: string;
  shape: JudgeShape;
  /** The dimensions it scores (appeal and extra shapes), or its recommendations name (influence). */
  dimensions: readonly string[];
  /** Moves its recommendations may name; `''` is always allowed. */
  moves: readonly string[];
  /** Red flags it may report (appeal shape only; may be empty). */
  flags: readonly string[];
  /** Perspective id → its lever ids (influence only). */
  perspectives: ReadonlyMap<string, readonly string[]>;
  /** Duty ids (the lenses judge only). */
  duties: readonly string[];
  /** Culture scale ids (the culture judge only). */
  scales: readonly string[];
  maxHighlights: number;
  maxRecommendations: number;
}

/** The ids a slot's reply may use: the same lists its prompt shows. */
export function judgeIds(m: EngineModel, slot: string): JudgeIds {
  const j = judgeFor(m, slot);
  const g = j.appeal;
  const shape = shapeOf(m, slot);
  const base = {
    group: g,
    shape,
    flags: [] as string[],
    perspectives: new Map<string, readonly string[]>(),
    duties: [] as string[],
    scales: [] as string[],
    maxHighlights: j.max_highlights,
    maxRecommendations: j.max_recommendations,
  };
  if (shape === 'influence') {
    return {
      ...base,
      dimensions: m.DIMS.map((d) => d.id),
      moves: m.data.moves.map((mv) => mv.id),
      perspectives: new Map(m.data.perspectives.map((p) => [p.id, p.levers.map((l) => l.id)])),
    };
  }
  if (shape === 'extra') {
    return {
      ...base,
      dimensions: m.EXTRA.filter((d) => d.group === g).map((d) => d.id),
      moves: [],
      scales: g === CULTURE_GROUP ? [...m.SCALE_IDS] : [],
    };
  }
  const dims = g === 'lenses' ? m.LENSES : m.DIMS.filter((d) => d.appeal === g);
  const ids = new Set(dims.map((d) => d.id));
  return {
    ...base,
    dimensions: dims.map((d) => d.id),
    moves: m.data.moves.filter((mv) => mv.dimensions.some((d) => ids.has(d))).map((mv) => mv.id),
    flags: m.data.red_flags.filter((f) => f.appeal === g).map((f) => f.id),
    duties: g === 'lenses' ? m.FN.map((f) => f.id) : [],
  };
}

/** An enum of ids. Strict mode refuses an empty one, so an empty list is a bug here. */
function oneOf(values: readonly string[], what: string) {
  if (values.length === 0) throw new Error(`A judge schema needs at least one ${what}`);
  return z.enum(values as [string, ...string[]]);
}

/** Numbers by fixed key: the strict form of a map (`duties`, `text_positions`). */
const numbersBy = (keys: readonly string[]) =>
  z.object(Object.fromEntries(keys.map((k) => [k, z.number()])));

function recommendation(ids: JudgeIds) {
  return z.object({
    dimension: oneOf(ids.dimensions, 'dimension'),
    move: oneOf(['', ...ids.moves], 'move'),
    issue: z.string(),
    original: z.string(),
    rewrite: z.string(),
    impact: z.enum(IMPACTS),
  });
}

/** The reply a slot's judge is asked for, as a Zod schema over the version's ids. */
export function judgeReplySchema(m: EngineModel, slot: string): z.ZodObject {
  const ids = judgeIds(m, slot);
  const appeal = oneOf([ids.group], 'appeal');
  const recommendations = z.array(recommendation(ids));

  if (ids.shape === 'influence') {
    const levers = [...ids.perspectives.values()].flat();
    return z.object({
      appeal,
      summary: z.string(),
      perspectives: z.array(
        z.object({
          id: oneOf([...ids.perspectives.keys()], 'perspective'),
          score: z.number(),
          summary: z.string(),
          levers: z.array(
            z.object({
              id: oneOf(levers, 'lever'),
              status: z.enum(LEVER_STATUSES),
              quote: z.string(),
              note: z.string(),
            })
          ),
        })
      ),
      recommendations,
    });
  }

  const dimension = oneOf(ids.dimensions, 'dimension');
  const shape: Record<string, z.ZodType> = {
    appeal,
    summary: z.string(),
    dimension_scores: z.array(
      z.object({ id: dimension, score: z.number(), rationale: z.string() })
    ),
    highlights: z.array(
      z.object({
        quote: z.string(),
        dimension,
        polarity: z.enum(POLARITIES),
        note: z.string(),
      })
    ),
    recommendations,
  };
  // A judge with no flags to report has no list for them: an empty enum is refused.
  if (ids.flags.length) {
    shape.red_flags = z.array(
      z.object({ id: oneOf(ids.flags, 'red flag'), quote: z.string(), note: z.string() })
    );
  }
  if (ids.duties.length) {
    shape.duties = numbersBy(ids.duties).extend({ primary: oneOf(ids.duties, 'duty') });
  }
  if (ids.scales.length) shape.text_positions = numbersBy(ids.scales);
  return z.object(shape);
}

/**
 * The JSON Schema a provider holds the slot's reply to, in OpenAI's strict
 * subset: no `$schema`, every object closed and every property required.
 */
export function outputSchema(m: EngineModel, slot: string): Record<string, unknown> {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(judgeReplySchema(m, slot));
  return schema;
}

/** The name the schema is sent under: short, and within every provider's tool-name charset. */
export const schemaName = (slot: string): string => `hdtl_${slot}`;
