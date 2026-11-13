/**
 * Synthetic judge outputs for the engine baseline (t-12).
 *
 * `assemble()` only takes its judge path when it is handed judge outputs, and
 * no recorded LLM output exists to hand it. So the baseline makes some up, and
 * makes them up the same way every time: every value below comes from the
 * model's ids, the text's sentences and the case id, through a fixed hash. No
 * clock, no randomness — re-running the recorder must reproduce the fixtures
 * byte for byte.
 *
 * Each output is shaped to walk the branches of `assemble()` that e2 has to
 * port, not to look like a plausible judgement:
 *
 *   • a score sent as a string, and one out of range (`+d.score`, `clamp`);
 *   • highlight quotes that `locate()` finds exactly, only case-insensitively,
 *     only once whitespace is collapsed, only by their first six words, and
 *     not at all — the case-insensitive one is how the `İ` offset shift shows;
 *   • a highlight polarity that is neither `strength` nor `weakness`;
 *   • a recommendation naming a move that does not exist;
 *   • a red flag the model does not know, and a lever status it does not know;
 *   • a culture position that is not a number, and one above 1;
 *   • in every list, one dimension / flag / perspective id that does not exist.
 *
 * Pure: nothing here imports the prototype. The recorder passes in the
 * sentences the prototype's `splitSentences` found.
 */
import { z } from 'zod';

/** The groups `assemble()` reads judge outputs for, in its own order. */
export const SYNTHETIC_GROUPS = [
  'ethos',
  'pathos',
  'logos',
  'kairos',
  'lenses',
  'craft',
  'audience',
  'culture',
  'influence',
] as const;

export type SyntheticGroup = (typeof SYNTHETIC_GROUPS)[number];

/** The ids that do not exist, one per kind, so the drop paths are pinned. */
export const MISSING = {
  dimension: 'zz_missing_dimension',
  move: 'mv_zz_missing',
  flag: 'rf_zz_missing',
  perspective: 'pv_zz_missing',
  lever: 'lv_zz_missing',
} as const;

const idList = z.array(z.object({ id: z.string() }));

/** Only the parts of the model the generator reads. */
export const syntheticModelSchema = z.object({
  dimensions: z.array(z.object({ id: z.string(), appeal: z.string() })),
  lenses: idList,
  extra_dimensions: z.array(z.object({ id: z.string(), group: z.string() })),
  moves: idList,
  red_flags: idList,
  duties: idList,
  perspectives: z.array(z.object({ id: z.string(), levers: idList })),
  culture: z.object({ scales: idList }),
});

export type SyntheticModel = z.infer<typeof syntheticModelSchema>;

/** FNV-1a, 32-bit. Stable across runs and platforms; that is all it is for. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const LEVER_STATUSES = ['present', 'absent', 'misused', 'not_applicable', 'bogus_status'];

/**
 * The highlight quotes, one per `locate()` path. `sentences` must be non-empty.
 *
 * The case-varied quote is the LAST sentence upper-cased, so a text with `İ`
 * earlier on puts the shift in front of it.
 */
export function highlightQuotes(sentences: readonly string[]): string[] {
  const first = sentences[0];
  const last = sentences[sentences.length - 1];
  const words = first.split(/\s+/);
  return [
    first,
    last.toUpperCase(),
    first.replace(' ', '   '),
    words.length > 6
      ? `${words.slice(0, 6).join(' ')} and then something the text never says`
      : `${first} and then something the text never says`,
    'A quote that appears nowhere in the text at all.',
  ];
}

interface DimensionLike {
  id: string;
}

function dimensionsOf(model: SyntheticModel, group: SyntheticGroup): DimensionLike[] {
  if (group === 'lenses') return model.lenses;
  if (group === 'craft' || group === 'audience' || group === 'culture') {
    return model.extra_dimensions.filter((d) => d.group === group);
  }
  return model.dimensions.filter((d) => d.appeal === group);
}

function recommendations(
  model: SyntheticModel,
  dims: readonly DimensionLike[],
  key: string
): Record<string, unknown>[] {
  const move = model.moves[hash(`${key}|move`) % model.moves.length].id;
  return [
    {
      dimension: dims[0].id,
      move,
      issue: `Synthetic issue for ${dims[0].id}.`,
      original: '',
      rewrite: `Synthetic rewrite for ${dims[0].id}.`,
      impact: 'high',
    },
    {
      dimension: dims[dims.length - 1].id,
      move: MISSING.move,
      issue: `Synthetic issue for ${dims[dims.length - 1].id}, with a move that does not exist.`,
      rewrite: 'Synthetic rewrite.',
    },
    {
      dimension: MISSING.dimension,
      move,
      issue: 'A recommendation on a dimension that does not exist.',
      rewrite: 'Dropped.',
      impact: 'low',
    },
  ];
}

/**
 * One judge output per group in {@link SYNTHETIC_GROUPS}, keyed by group.
 *
 * `caseId` seeds the hash, so two cases on the same text still differ.
 */
export function syntheticJudgeOutputs(
  model: SyntheticModel,
  sentences: readonly string[],
  caseId: string
): Record<SyntheticGroup, Record<string, unknown>> {
  const S = sentences.length ? sentences : ['(empty)'];
  const quotes = highlightQuotes(S);

  const one = (group: SyntheticGroup): Record<string, unknown> => {
    const key = `${caseId}|${group}`;

    if (group === 'influence') {
      const dims = model.dimensions;
      return {
        appeal: 'influence',
        summary: `Synthetic influence summary for ${caseId}.`,
        perspectives: [
          ...model.perspectives.map((p, pi) => ({
            id: p.id,
            score: hash(`${key}|${p.id}`) % 5,
            summary: pi === 0 ? undefined : `Synthetic ${p.id}.`,
            levers: [
              ...p.levers.map((l, li) => {
                const status = LEVER_STATUSES[(pi + li) % LEVER_STATUSES.length];
                return {
                  id: l.id,
                  status,
                  ...(status === 'present' || status === 'misused'
                    ? { quote: S[hash(`${key}|${l.id}`) % S.length], note: `Synthetic ${l.id}.` }
                    : {}),
                };
              }),
              { id: MISSING.lever, status: 'present', quote: S[0] },
            ],
          })),
          { id: MISSING.perspective, score: 4, summary: 'Dropped.', levers: [] },
        ],
        recommendations: recommendations(model, dims, key),
      };
    }

    const dims = dimensionsOf(model, group);
    const output: Record<string, unknown> = {
      appeal: group,
      dimension_scores: [
        ...dims.map((d, k) => {
          const score = hash(`${key}|${d.id}`) % 5;
          return {
            id: d.id,
            score: k === 0 ? String(score) : k === 1 ? 7 : score,
            rationale: `Synthetic ${group} rationale for ${d.id}.`,
          };
        }),
        { id: MISSING.dimension, score: 3, rationale: 'Dropped.' },
      ],
      highlights: [
        ...quotes.map((quote, k) => ({
          quote,
          dimension: dims[k % dims.length].id,
          polarity: k === 2 ? 'neutral' : k % 2 ? 'weakness' : 'strength',
          ...(k === 1 ? {} : { note: `Synthetic highlight ${k}.` }),
        })),
        { quote: S[0], dimension: MISSING.dimension, polarity: 'strength', note: 'Dropped.' },
      ],
      recommendations: recommendations(model, dims, key),
      red_flags: [
        {
          id: model.red_flags[hash(`${key}|flag`) % model.red_flags.length].id,
          quote: S[S.length - 1],
          note: 'Synthetic red flag.',
        },
        { id: MISSING.flag, quote: S[0], note: 'Dropped.' },
      ],
    };
    // One group with no summary at all, so the `|| ""` default is pinned.
    if (group !== 'kairos') output.summary = `Synthetic ${group} summary for ${caseId}.`;

    if (group === 'lenses') {
      output.duties = Object.fromEntries(
        model.duties.map((f, k) => [
          f.id,
          k === 0 ? String(hash(`${key}|${f.id}`) % 50) : hash(`${key}|${f.id}`) % 50,
        ])
      );
    }
    if (group === 'culture') {
      output.text_positions = Object.fromEntries(
        model.culture.scales.map((s, k) => [
          s.id,
          k === 0 ? '0.5' : k === 1 ? 1.4 : (hash(`${key}|${s.id}`) % 101) / 100,
        ])
      );
    }
    return output;
  };

  return {
    ethos: one('ethos'),
    pathos: one('pathos'),
    logos: one('logos'),
    kairos: one('kairos'),
    lenses: one('lenses'),
    craft: one('craft'),
    audience: one('audience'),
    culture: one('culture'),
    influence: one('influence'),
  };
}
