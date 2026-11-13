/**
 * The duty fix (BRIEF §5): `primaryDuty` takes the highest-weighted duty, not
 * the one weighted `=== 40` as the prototype's `rewritePrompt()` did.
 */
import { describe, expect, it } from 'vitest';
import { indexModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import {
  fnTarget,
  primaryDuty,
  primaryDutyOf,
} from '@/lib/app/frameworks/howdoesthisland/engine/scoring';
import type { EngineContext } from '@/lib/app/frameworks/howdoesthisland/engine/types';
import { loadModel } from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

const m = indexModel(loadModel());
const ctx = (archetype: string, role = ''): EngineContext => ({
  contentType: 'general',
  archetype,
  role,
  audience: {},
});

/** prototype/src/engine.js `rewritePrompt()`'s rule, for comparison. */
const prototypeNeed = (target: Record<string, number> | null) =>
  target ? m.FN.find((f) => target[f.id] === 40)?.id : null;

describe('primaryDuty', () => {
  it('is the archetype’s primary duty, for every archetype that has one', () => {
    const withPrimary = m.data.archetypes.filter((a) => a.primary);
    expect(withPrimary.length).toBeGreaterThan(0);
    for (const a of withPrimary) expect(primaryDuty(m, ctx(a.id)), a.id).toBe(a.primary);
  });

  it('is the role’s primary duty when a role is named, for every role', () => {
    expect(m.data.exec_roles.length).toBeGreaterThan(0);
    for (const r of m.data.exec_roles)
      expect(primaryDuty(m, ctx('general', r.id)), r.id).toBe(r.primary);
  });

  it('is null when nothing names a primary duty', () => {
    expect(fnTarget(m, ctx('general'))).toBeNull();
    expect(primaryDuty(m, ctx('general'))).toBeNull();
  });

  it('takes the highest weight whatever it is (fails on the prototype’s === 40)', () => {
    const target = { teach: 30, delight: 10, move: 15, steer: 35, unsettle: 10 };
    expect(primaryDutyOf(m, target)).toBe('steer');
    expect(prototypeNeed(target)).toBeUndefined();
  });

  it('takes the first in the model’s order on a tie, and skips a duty the target lacks', () => {
    const order = m.FN.map((f) => f.id);
    expect(primaryDutyOf(m, Object.fromEntries(order.map((id) => [id, 20])))).toBe(order[0]);
    expect(primaryDutyOf(m, { [order[2]]: 5 })).toBe(order[2]);
    expect(primaryDutyOf(m, null)).toBeNull();
  });

  it('agrees with the prototype on today’s targets, where the primary is exactly 40', () => {
    for (const r of m.data.exec_roles) {
      const target = fnTarget(m, ctx('general', r.id));
      expect(primaryDutyOf(m, target)).toBe(prototypeNeed(target));
    }
  });
});
