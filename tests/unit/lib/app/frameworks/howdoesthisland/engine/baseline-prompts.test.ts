/**
 * The judge prompts against the prototype's (t-18).
 *
 * For every case in the baseline and every judge slot, the port's prompt is
 * the one the prototype's `judgePrompt()` built, byte for byte. No difference
 * is listed: the port changes nothing a judge is told. A prompt is what
 * calibration measures, so a change to one is a change to the framework's
 * behaviour, and belongs in a listed difference with the fix it traces to,
 * in the way `baseline-differences.ts` lists the scoring ones.
 */
import { describe, expect, it } from 'vitest';
import { indexModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import { judgePrompt } from '@/lib/app/frameworks/howdoesthisland/engine/prompts';
import { HOWDOESTHISLAND_JUDGE_SLOTS } from '@/lib/app/frameworks/howdoesthisland/judge-slots';
import {
  loadCases,
  loadModel,
  loadPrompts,
} from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

const m = indexModel(loadModel());
const cases = loadCases();
const recorded = loadPrompts();

describe('the judge prompts against the prototype baseline', () => {
  it('has a recorded prompt for every case and every slot, and nothing else', () => {
    expect([...recorded.keys()].sort()).toEqual(cases.map((c) => c.file).sort());
    for (const slots of recorded.values()) {
      expect([...slots.keys()].sort()).toEqual([...HOWDOESTHISLAND_JUDGE_SLOTS].sort());
    }
  });

  it('builds every prompt exactly as the prototype did', () => {
    let compared = 0;
    for (const c of cases) {
      for (const slot of HOWDOESTHISLAND_JUDGE_SLOTS) {
        // The baseline was recorded with culture on: the prototype has no switch.
        const prompt = judgePrompt(m, slot, c.input.text, c.input.ctx, { culture: true });
        expect(prompt, `${c.file} ${slot}`).toBe(recorded.get(c.file)?.get(slot));
        compared++;
      }
    }
    expect(compared).toBe(66 * 9);
  });
});
