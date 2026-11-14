/**
 * Which judges run, and the call each makes (t-18): the engine's
 * `activeJudgeSlots` and `buildJudgeRequest`.
 *
 * **Profiles** (plan §4): `quick` runs no judge, `full` every judge the
 * engine can run, and a name from the version's `judge_catalogue` that
 * group plus the groups marked `always` (the four appeals). An explicit list
 * runs exactly the slots named. The culture judge is left out of `full` with
 * the culture switch off (D11), and asking for it by name or by its group is
 * refused, as an unknown slot is.
 *
 * **Limits** are interim, per shape, and sit under each agent's ceiling
 * (`lib/app/judges/agents.ts`: 16,384 tokens for a judge, 32,768 for the
 * influence judge), so a call has room before the ceiling refuses it. The
 * influence reply (13 perspectives × 6 levers) is several times the others'.
 * k3 measures them; once workspaces choose from approved models (j4), each
 * model's entry carries its own.
 */
import {
  JudgeProfileError,
  type JudgeProfile,
  type JudgeRequest,
} from '@/lib/app/frameworks/engine';
import {
  outputSchema,
  schemaName,
  shapeOf,
  type JudgeShape,
} from '@/lib/app/frameworks/howdoesthisland/engine/judge-schemas';
import { CULTURE_GROUP, type EngineModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import { judgePrompt } from '@/lib/app/frameworks/howdoesthisland/engine/prompts';
import type { EngineContext } from '@/lib/app/frameworks/howdoesthisland/engine/types';

export const JUDGE_LIMITS: Readonly<Record<JudgeShape, { maxTokens: number; timeoutMs: number }>> =
  {
    appeal: { maxTokens: 8_192, timeoutMs: 120_000 },
    extra: { maxTokens: 8_192, timeoutMs: 120_000 },
    influence: { maxTokens: 24_576, timeoutMs: 240_000 },
  };

/** Every slot, in the version's order. */
const allSlots = (m: EngineModel): string[] => m.data.judges.map((j) => j.id);

/** The slots this engine can run: all but culture's with the switch off. */
function runnable(m: EngineModel, culture: boolean): Set<string> {
  return new Set(
    m.data.judges.filter((j) => culture || j.appeal !== CULTURE_GROUP).map((j) => j.id)
  );
}

export function activeJudgeSlots(
  m: EngineModel,
  profile: JudgeProfile,
  opts: { culture: boolean }
): readonly string[] {
  const can = runnable(m, opts.culture);
  const inOrder = (wanted: ReadonlySet<string>) => allSlots(m).filter((s) => wanted.has(s));

  if (typeof profile !== 'string') {
    for (const slot of profile) {
      if (!m.JUDGE.has(slot)) throw new JudgeProfileError(`There is no judge slot '${slot}'`);
      if (!can.has(slot)) {
        throw new JudgeProfileError(`The ${slot} judge does not run with the culture switch off`);
      }
    }
    return inOrder(new Set(profile));
  }
  if (profile === 'quick') return [];
  if (profile === 'full') return inOrder(can);

  const group = m.data.judge_catalogue.find((g) => g.id === profile);
  if (!group) throw new JudgeProfileError(`There is no judge profile '${profile}'`);
  const bySlotAppeal = new Map(m.data.judges.map((j) => [j.appeal, j.id]));
  const slots = new Set<string>();
  for (const g of m.data.judge_catalogue) {
    if (g !== group && !g.always) continue;
    for (const appeal of g.judges) {
      const slot = bySlotAppeal.get(appeal);
      if (!slot) throw new Error(`The judge catalogue names '${appeal}', which has no judge`);
      if (!can.has(slot)) {
        throw new JudgeProfileError(`The ${profile} judges do not run with the culture switch off`);
      }
      slots.add(slot);
    }
  }
  return inOrder(slots);
}

export function buildJudgeRequest(
  m: EngineModel,
  slot: string,
  text: string,
  ctx: EngineContext,
  opts: { culture: boolean; projectContext?: string | null }
): JudgeRequest {
  return {
    slot,
    prompt: judgePrompt(m, slot, text, ctx, opts),
    schema: outputSchema(m, slot),
    schemaName: schemaName(slot),
    ...JUDGE_LIMITS[shapeOf(m, slot)],
  };
}
