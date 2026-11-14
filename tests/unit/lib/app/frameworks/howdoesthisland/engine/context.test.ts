/**
 * Tests: `engine.parseContext` (t-24) — a caller's context checked against
 * the 0.5.1 model it is scored with, defaults applied.
 *
 * Real model, real engine. The point is that what passes can be scored: an
 * accepted context runs the quick scan and builds every judge's prompt
 * without throwing, and an id the model lacks is refused by path before it
 * could throw part way through a run.
 */
import { describe, expect, it } from 'vitest';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import type { EngineContext } from '@/lib/app/frameworks/howdoesthisland/engine';
import {
  loadCases,
  loadModel,
} from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

const model = loadModel();
const on = createHowDoesThisLandEngine(model, { culture: true });
const off = createHowDoesThisLandEngine(model, { culture: false });

function accepted(input: unknown, engine = on): EngineContext {
  const parsed = engine.parseContext(input);
  if (!parsed.ok) throw new Error(`refused: ${JSON.stringify(parsed.issues)}`);
  return parsed.ctx;
}

function refusedAt(input: unknown, engine = on): string[] {
  const parsed = engine.parseContext(input);
  if (parsed.ok) throw new Error('accepted');
  return parsed.issues.map((issue) => issue.path);
}

describe('defaults', () => {
  it("fills an empty context with the prototype's DEFAULT_CTX", () => {
    expect(accepted(undefined)).toEqual({
      contentType: 'general',
      archetype: 'general',
      audience: {
        involvement: 'medium',
        awareness: 'problem_aware',
        relationship: 'warm',
        decision_unit: 'individual',
        focus: 'unknown',
        expertise: 'informed',
      },
    });
    expect(accepted({})).toEqual(accepted(undefined));
  });

  it('keeps what the caller chose and defaults only the rest', () => {
    const ctx = accepted({
      contentType: 'exec_briefing',
      role: 'cfo',
      audience: { relationship: 'cold' },
      culture: { reader: 'jp', writer: 'us' },
    });
    expect(ctx).toMatchObject({
      contentType: 'exec_briefing',
      archetype: 'general',
      role: 'cfo',
      culture: { reader: 'jp', writer: 'us' },
    });
    expect(ctx.audience.relationship).toBe('cold');
    expect(ctx.audience.involvement).toBe('medium');
  });

  it('accepts the context of every baseline case whose reader the model has', () => {
    const countries = new Set(
      (model as { culture: { countries: { id: string }[] } }).culture.countries.map((c) => c.id)
    );
    let refused = 0;
    for (const c of loadCases()) {
      const reader = c.input.ctx.culture?.reader;
      // The baseline's `zz` checks the engine's own fallback for an unknown
      // reader (a global audience). The API refuses it instead: a typo such
      // as `jpn` should not be scored as a global reader without a word.
      if (reader && reader !== 'global' && !countries.has(reader)) {
        expect(refusedAt(c.input.ctx), c.file).toContain('culture.reader');
        refused += 1;
        continue;
      }
      expect(accepted(c.input.ctx), c.file).toEqual(
        expect.objectContaining({
          contentType: c.input.ctx.contentType,
          archetype: c.input.ctx.archetype,
        })
      );
    }
    expect(refused).toBeGreaterThan(0);
  });
});

describe('what is accepted can be scored', () => {
  it('runs the quick scan and builds every judge prompt for a defaulted context', () => {
    const ctx = accepted({ role: 'cto', culture: { reader: 'global' } });
    const text = 'We cut onboarding from two weeks to two days. Book a demo this week.';
    expect(() => on.assemble(text, ctx, on.quickScan(text, ctx))).not.toThrow();
    for (const slot of on.activeJudgeSlots('full')) {
      expect(() => on.buildJudgeRequest(slot, text, ctx), slot).not.toThrow();
    }
  });
});

describe('refusals', () => {
  it('refuses ids the version does not have, by path', () => {
    expect(refusedAt({ contentType: 'haiku' })).toEqual(['contentType']);
    expect(refusedAt({ archetype: 'wizard' })).toEqual(['archetype']);
    expect(refusedAt({ role: 'cfoo' })).toEqual(['role']);
    expect(refusedAt({ audience: { involvement: 'total' } })).toEqual(['audience.involvement']);
    expect(refusedAt({ culture: { reader: 'atlantis' } })).toEqual(['culture.reader']);
  });

  it('refuses keys it does not know, so a typo is not silently ignored', () => {
    expect(refusedAt({ content_type: 'general' })).toEqual(['']);
    expect(refusedAt({ audience: { mood: 'happy' } })).toEqual(['audience']);
  });

  it('refuses a non-object', () => {
    expect(refusedAt('general')).toEqual(['']);
  });

  it('refuses culture with the culture switch off, and accepts the rest', () => {
    expect(refusedAt({ culture: { reader: 'jp' } }, off)).toEqual(['culture']);
    expect(accepted({ contentType: 'speech' }, off)).not.toHaveProperty('culture');
  });
});
