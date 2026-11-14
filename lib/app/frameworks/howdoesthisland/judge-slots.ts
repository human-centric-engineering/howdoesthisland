/**
 * The HowDoesThisLand judge slots, listed in model 0.5.1's order.
 *
 * On their own so the judges' platform agents (`lib/app/judges/agents.ts`) can
 * name them without importing the framework definition, which brings the
 * engine, the schemas and the env module into the platform-agent registry's
 * import graph. The definition reads them from here too, and the codec refuses
 * a model version whose `judges[]` ids are not this set (in any order).
 *
 * Culture is listed whether or not the culture switch is on: the switch decides
 * whether the slot runs (f-assessments), not whether its agent exists.
 */
export const HOWDOESTHISLAND_JUDGE_SLOTS = [
  'judge_ethos',
  'judge_pathos',
  'judge_logos',
  'judge_kairos',
  'judge_lenses',
  'judge_influence',
  'judge_craft',
  'judge_audience',
  'judge_culture',
] as const;

export type HowDoesThisLandJudgeSlot = (typeof HOWDOESTHISLAND_JUDGE_SLOTS)[number];
