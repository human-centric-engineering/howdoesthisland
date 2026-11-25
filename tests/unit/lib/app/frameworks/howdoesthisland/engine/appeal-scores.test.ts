/**
 * Tests: `appealScores` (t-87) — a stored result's score on each appeal, as a
 * comparison of drafts reads it.
 *
 * @see lib/app/frameworks/howdoesthisland/engine/appeal-scores.ts
 */
import { describe, expect, it } from 'vitest';
import { appealScores } from '@/lib/app/frameworks/howdoesthisland/engine/appeal-scores';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import { loadModel } from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

describe('appealScores', () => {
  it('reads each appeal from a result the engine assembled, in the model’s order', () => {
    const engine = createHowDoesThisLandEngine(loadModel(), { culture: true });
    const text = 'We cut onboarding from two weeks to two days. Book a demo this week.';
    const ctx = engine.parseContext({ contentType: 'landing_page' });
    if (!ctx.ok) throw new Error('context refused');
    const result = engine.assemble(text, ctx.ctx, engine.quickScan(text, ctx.ctx));
    // Round-tripped as the database stores it.
    const stored: unknown = JSON.parse(JSON.stringify(result));

    const scores = engine.appealScores(stored);

    expect(scores?.map((s) => s.appeal)).toEqual(['ethos', 'pathos', 'logos', 'kairos']);
    const { scores: own } = result as { scores: Record<string, number> };
    expect(scores).toEqual(scores?.map((s) => ({ appeal: s.appeal, score: own[s.appeal] })));
  });

  it('is null for a result missing an appeal, or one that is not a result at all', () => {
    expect(appealScores({ scores: { overall: 50, ethos: 1, pathos: 2, logos: 3 } })).toBeNull();
    expect(appealScores({ scores: { ethos: '1', pathos: 2, logos: 3, kairos: 4 } })).toBeNull();
    expect(appealScores(null)).toBeNull();
    expect(appealScores('scores')).toBeNull();
  });
});
