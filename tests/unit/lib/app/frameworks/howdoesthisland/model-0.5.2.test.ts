/**
 * Model 0.5.2 (t-73): 0.5.1 with the adjustment bounds the owner chose, and
 * nothing else. A project's overlay is checked against them as it would be
 * on a review.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { decompose } from '@/lib/app/frameworks/codec';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import { indexModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import { parseOverlay } from '@/lib/app/frameworks/howdoesthisland/engine/overlay';
import { effectiveWeights } from '@/lib/app/frameworks/howdoesthisland/engine/scoring';
import type { EngineContext } from '@/lib/app/frameworks/howdoesthisland/engine/types';
import type { JsonObject } from '@/lib/app/frameworks/types';
import { sha256 } from '@/lib/app/frameworks/store';

const DATA = 'lib/app/frameworks/howdoesthisland/data';
const FILE_0_5_2 = `${DATA}/model-0.5.2.json`;
const SHA256_0_5_2 = '49ed3c8fdb2a9f94ebd5250195eb5d17fe0f98a7c08935b2b7db9a6176c895aa';

const read = (file: string): JsonObject =>
  z.looseObject({}).parse(JSON.parse(readFileSync(file, 'utf8')));

/** A top-level section of the model, as an object. */
const section = z.record(z.string(), z.unknown());

const v051 = read(`${DATA}/model-0.5.1.json`);
const v052 = read(FILE_0_5_2);
const model = indexModel(v052);

const BOUNDS = {
  weights: { ethos: 0.1, pathos: 0.1, logos: 0.1, kairos: 0.05 },
  priority_dimensions: { add: 2, remove: 1 },
};

describe('model-0.5.2.json', () => {
  it('has the recorded sha256', async () => {
    expect(await sha256(readFileSync(FILE_0_5_2, 'utf8'))).toBe(SHA256_0_5_2);
  });

  it('is 0.5.1 with a new version, a change note and the bounds, and nothing else', () => {
    const meta = section.parse(v052.meta);
    const scoring = section.parse(v052.scoring);
    expect(meta.version).toBe('0.5.2');
    expect(meta.changes_from_0_5_1).toEqual([expect.stringContaining('adjustment_bounds')]);
    expect(scoring.adjustment_bounds).toEqual(BOUNDS);

    const { version: _v, changes_from_0_5_1: _c, ...restMeta } = meta;
    const { adjustment_bounds: _b, ...restScoring } = scoring;
    const old = section.parse(v051.meta);
    expect({ ...v052, meta: restMeta, scoring: restScoring }).toEqual({
      ...v051,
      meta: { ...old, version: undefined },
    });
  });

  it('imports with no problems, and the engine reads its bounds', () => {
    expect(decompose(howDoesThisLand, v052).problems).toEqual([]);
    expect(model.BOUNDS).toEqual(BOUNDS);
  });

  it('scores as 0.5.1 does when a project adjusts nothing', () => {
    const before = indexModel(v051);
    const types = z.array(z.object({ id: z.string() })).parse(v052.content_types);
    expect(types.length).toBeGreaterThan(0);
    for (const { id } of types) {
      const ctx: EngineContext = { contentType: id, archetype: 'general', audience: {} };
      expect(effectiveWeights(model, ctx, { culture: false })).toEqual(
        effectiveWeights(before, ctx, { culture: false })
      );
    }
  });
});

describe('a project overlay against 0.5.2', () => {
  it('accepts one at every bound', () => {
    const overlay = {
      weights: { ethos: 0.1, pathos: -0.1, logos: 0.1, kairos: -0.05 },
      priorityDimensions: { add: ['kai_call', 'eth_integrity'], remove: ['pat_stakes'] },
    };
    expect(parseOverlay(model, overlay)).toEqual({ ok: true, overlay });
  });

  it('refuses one past a bound, appeal by appeal and list by list', () => {
    const parsed = parseOverlay(model, {
      weights: { ethos: -0.11, pathos: 0.1, logos: 0.15, kairos: 0.06 },
      priorityDimensions: {
        add: ['kai_call', 'eth_integrity', 'kai_moment'],
        remove: ['pat_stakes', 'log_clarity'],
      },
    });
    expect(parsed.ok ? [] : parsed.issues).toEqual([
      {
        path: 'weights.ethos',
        message: 'This version lets a project move ethos by at most 10 points either way',
      },
      {
        path: 'weights.logos',
        message: 'This version lets a project move logos by at most 10 points either way',
      },
      {
        path: 'weights.kairos',
        message: 'This version lets a project move kairos by at most 5 points either way',
      },
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
});
