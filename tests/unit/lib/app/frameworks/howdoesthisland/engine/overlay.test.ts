/**
 * A project's adjustment to the weights (D5, t-72): the bounds a version
 * declares, the overlay's check against them, and what the engine does with
 * one. 0.5.1 declares no bounds; the fixture version here is 0.5.1 with some.
 */
import { describe, expect, it } from 'vitest';
import { decompose } from '@/lib/app/frameworks/codec';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import { indexModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import { parseOverlay } from '@/lib/app/frameworks/howdoesthisland/engine/overlay';
import {
  appealScore,
  effectiveWeights,
  priorityDimensions,
} from '@/lib/app/frameworks/howdoesthisland/engine/scoring';
import type { EngineContext } from '@/lib/app/frameworks/howdoesthisland/engine/types';
import type { JsonObject } from '@/lib/app/frameworks/types';
import {
  asRecorded,
  loadCases,
  loadModel,
} from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

const BOUNDS = {
  weights: { ethos: 0.1, pathos: 0.05, logos: 0.05 },
  priority_dimensions: { add: 2, remove: 1 },
};

/** 0.5.1 with `bounds` as its `scoring.adjustment_bounds`. */
function withBounds(bounds: unknown = BOUNDS): JsonObject {
  const model = structuredClone(loadModel()) as JsonObject;
  const scoring = model.scoring as JsonObject;
  model.scoring = { ...scoring, adjustment_bounds: bounds };
  return model;
}

const plain = indexModel(loadModel());
const bounded = indexModel(withBounds());

const ctx: EngineContext = { contentType: 'general', archetype: 'general', audience: {} };

describe('adjustment bounds in the model', () => {
  it('0.5.1 declares none, and still imports with no problems', () => {
    expect(plain.BOUNDS).toBeNull();
    expect(decompose(howDoesThisLand, loadModel() as JsonObject).problems).toEqual([]);
  });

  it('a version may declare them, and the import takes them', () => {
    expect(bounded.BOUNDS).toEqual(BOUNDS);
    expect(decompose(howDoesThisLand, withBounds()).problems).toEqual([]);
  });

  it.each([
    ['a misspelt appeal', { weights: { ethso: 0.1 } }],
    ['a negative bound', { weights: { ethos: -0.1 } }],
    ['a bound over the whole mix', { weights: { ethos: 1.5 } }],
    ['a fractional count', { priority_dimensions: { add: 1.5 } }],
    ['an unknown key', { weights: { ethos: 0.1 }, rubric: true }],
    ['an empty block', {}],
  ])('the import refuses %s', (_what, bounds) => {
    const { problems } = decompose(howDoesThisLand, withBounds(bounds));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^scoring: /);
    expect(problems[0]).toContain('adjustment_bounds');
  });

  it('reads bounds that allow nothing as none, as the catalogue does (review round 3)', () => {
    const zero = indexModel(withBounds({ weights: { ethos: 0 }, priority_dimensions: { add: 0 } }));
    expect(zero.BOUNDS).toBeNull();
    expect(parseOverlay(zero, { weights: { ethos: 0.01 } })).toEqual({
      ok: false,
      issues: [
        { path: 'weights', message: 'This version declares no bounds, so it allows no adjustment' },
      ],
    });
  });

  it('the engine refuses malformed bounds too, naming the field', () => {
    expect(() => indexModel(withBounds({ weights: { ethos: 'lots' } }))).toThrow(
      /adjustment_bounds/
    );
  });
});

describe('parseOverlay', () => {
  it('takes no overlay, and one that changes nothing, as none', () => {
    expect(parseOverlay(plain, undefined)).toEqual({ ok: true, overlay: null });
    expect(parseOverlay(plain, null)).toEqual({ ok: true, overlay: null });
    expect(parseOverlay(plain, {})).toEqual({ ok: true, overlay: null });
    expect(
      parseOverlay(plain, { weights: { ethos: 0 }, priorityDimensions: { add: [], remove: [] } })
    ).toEqual({ ok: true, overlay: null });
  });

  it('refuses any adjustment on a version without bounds, by field', () => {
    expect(
      parseOverlay(plain, { weights: { ethos: 0.01 }, priorityDimensions: { add: ['kai_call'] } })
    ).toEqual({
      ok: false,
      issues: [
        {
          path: 'weights',
          message: 'This version declares no bounds, so it allows no adjustment',
        },
        {
          path: 'priorityDimensions',
          message: 'This version declares no bounds, so it allows no adjustment',
        },
      ],
    });
  });

  it('accepts an overlay within the bounds, dropping what changes nothing', () => {
    expect(
      parseOverlay(bounded, {
        weights: { ethos: 0.1, pathos: -0.05, logos: 0 },
        priorityDimensions: { add: ['kai_call', 'eth_integrity'], remove: ['pat_stakes'] },
      })
    ).toEqual({
      ok: true,
      overlay: {
        weights: { ethos: 0.1, pathos: -0.05 },
        priorityDimensions: { add: ['kai_call', 'eth_integrity'], remove: ['pat_stakes'] },
      },
    });
  });

  it('refuses a move past a bound, and any move of an appeal with none', () => {
    const parsed = parseOverlay(bounded, { weights: { ethos: -0.11, kairos: 0.01 } });
    expect(parsed).toEqual({
      ok: false,
      issues: [
        {
          path: 'weights.ethos',
          message: 'This version lets a project move ethos by at most 10 points either way',
        },
        { path: 'weights.kairos', message: 'This version does not let a project move kairos' },
      ],
    });
  });

  it('refuses unknown ids, a lens, repeats, and an id both added and removed, by index', () => {
    const parsed = parseOverlay(bounded, {
      priorityDimensions: { add: ['nope', 'lens_mythos'], remove: ['kai_call'] },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toEqual([
      { path: 'priorityDimensions.add.0', message: 'Not a core dimension in this version' },
      { path: 'priorityDimensions.add.1', message: 'Not a core dimension in this version' },
    ]);
    const twice = parseOverlay(bounded, {
      priorityDimensions: { add: ['kai_call', 'kai_call'], remove: ['kai_call'] },
    });
    expect(twice.ok ? [] : twice.issues).toEqual([
      { path: 'priorityDimensions.add.1', message: 'Listed twice' },
      { path: 'priorityDimensions.remove.0', message: 'Both added and removed' },
    ]);
  });

  it('refuses more additions or removals than the version allows', () => {
    const parsed = parseOverlay(bounded, {
      priorityDimensions: {
        add: ['kai_call', 'eth_integrity', 'kai_moment'],
        remove: ['pat_stakes', 'log_clarity'],
      },
    });
    expect(parsed.ok ? [] : parsed.issues).toEqual([
      {
        path: 'priorityDimensions.add',
        message: 'This version lets a project add at most 2 priority dimensions',
      },
      {
        path: 'priorityDimensions.remove',
        message: 'This version lets a project remove at most 1 priority dimension',
      },
    ]);
  });

  it('refuses a shape it does not know, by path, and never anything but numbers and ids', () => {
    const parsed = parseOverlay(bounded, {
      weights: { ethos: '0.1' },
      rubric: { eth_goodwill: 'x' },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.map((i) => i.path).sort()).toEqual(['', 'weights.ethos']);
  });
});

describe('the engine with an overlay', () => {
  it('moves the effective weights as declared, then floors and normalises them', () => {
    const base = effectiveWeights(bounded, ctx, { culture: false });
    const moved = effectiveWeights(bounded, ctx, {
      culture: false,
      overlay: { weights: { ethos: 0.1 } },
    });
    // general is 0.28 / 0.28 / 0.28 / 0.16: +0.1 on ethos, over a total of 1.1.
    expect(base).toEqual({ ethos: 0.28, pathos: 0.28, logos: 0.28, kairos: 0.16 });
    expect(moved).toEqual({
      ethos: +(0.38 / 1.1).toFixed(3),
      pathos: +(0.28 / 1.1).toFixed(3),
      logos: +(0.28 / 1.1).toFixed(3),
      kairos: +(0.16 / 1.1).toFixed(3),
    });
  });

  it('adds and removes priority dimensions, which the appeal scores then weight', () => {
    const overlay = { priorityDimensions: { add: ['eth_integrity'], remove: ['eth_goodwill'] } };
    expect(priorityDimensions(bounded, ctx)).toEqual(['log_clarity', 'pat_stakes', 'eth_goodwill']);
    expect(priorityDimensions(bounded, ctx, overlay)).toEqual([
      'log_clarity',
      'pat_stakes',
      'eth_integrity',
    ]);
    // Integrity strong, goodwill weak: making integrity the priority lifts ethos.
    const sc = Object.fromEntries(bounded.DIMS.map((d) => [d.id, 2]));
    sc.eth_integrity = 4;
    sc.eth_goodwill = 2;
    expect(appealScore(bounded, 'ethos', sc, ctx, overlay)).toBeGreaterThan(
      appealScore(bounded, 'ethos', sc, ctx)
    );
  });

  it('carries through assembly and the judges’ prompts', () => {
    const engine = createHowDoesThisLandEngine(withBounds(), { culture: false });
    const parsed = engine.parseContext({});
    if (!parsed.ok) throw new Error('the default context should parse');
    const ctx = parsed.ctx;
    const overlay = { weights: { ethos: 0.1 }, priorityDimensions: { add: ['kai_moment'] } };
    const adjusted = engine.withOverlay(overlay);
    const text = 'We help small teams ship faster. Book a call today.';
    const quick = engine.quickScan(text, ctx);
    expect(adjusted.overlay).toEqual(overlay);
    expect(engine.overlay).toBeNull();
    expect(adjusted.assemble(text, ctx, structuredClone(quick)).effective_weights.ethos).toBe(
      +(0.38 / 1.1).toFixed(3)
    );
    const prompt = adjusted.buildJudgeRequest('judge_ethos', text, ctx).prompt;
    expect(prompt).toContain('ethos 35%');
    expect(prompt).toContain(
      'Priority dimensions: log_clarity, pat_stakes, eth_goodwill, kai_moment.'
    );
    expect(engine.buildJudgeRequest('judge_ethos', text, ctx).prompt).toContain('ethos 28%');
  });

  it('without one, or with withOverlay(null), every baseline case scores exactly as before', () => {
    const engine = createHowDoesThisLandEngine(loadModel(), { culture: true });
    const unadjusted = createHowDoesThisLandEngine(withBounds(), { culture: true }).withOverlay(
      null
    );
    for (const c of loadCases()) {
      const { text, ctx: caseCtx } = c.input;
      const q = engine.quickScan(text, caseCtx);
      const full = (e: typeof engine) =>
        asRecorded(
          e.assemble(text, caseCtx, structuredClone(q), structuredClone(c.judgeOutputs), 'b')
        );
      // The model's version is the same; only the bounds differ, and nothing reads them.
      expect(full(unadjusted), c.file).toEqual(full(engine));
    }
  });
});
