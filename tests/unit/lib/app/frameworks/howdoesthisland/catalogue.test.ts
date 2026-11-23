/**
 * The catalogue's adjustment bounds (t-72): what a project may move, never
 * the weights it moves.
 */
import { describe, expect, it } from 'vitest';
import { howDoesThisLandCatalogue } from '@/lib/app/frameworks/howdoesthisland/catalogue';
import type { JsonObject } from '@/lib/app/frameworks/types';
import { loadModel } from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';
import { z } from 'zod';

const request = z.object({ request: z.object({ adjustment: z.unknown() }) });

function withBounds(bounds: unknown): JsonObject {
  const model = structuredClone(loadModel()) as JsonObject;
  model.scoring = { ...(model.scoring as JsonObject), adjustment_bounds: bounds };
  return model;
}

describe('the catalogue’s adjustment', () => {
  it('is null for 0.5.1, which declares no bounds', () => {
    const catalogue = howDoesThisLandCatalogue(loadModel());
    expect(request.parse(catalogue).request.adjustment).toBeNull();
  });

  it('serves the bounds, an appeal or count left out as 0, and no weight', () => {
    const catalogue = howDoesThisLandCatalogue(
      withBounds({ weights: { ethos: 0.1 }, priority_dimensions: { add: 2 } })
    );
    expect(request.parse(catalogue).request.adjustment).toEqual({
      weights: { ethos: 0.1, pathos: 0, logos: 0, kairos: 0 },
      priorityDimensions: { add: 2, remove: 0 },
    });
    // Neither a content type's mix nor its priorities.
    const served = JSON.stringify(catalogue);
    expect(served).not.toContain('priority_dimensions');
    expect(served).not.toContain('"weights":{"ethos":0.28');
  });

  it('is null for bounds that allow nothing, as for none (review round 1)', () => {
    for (const bounds of [
      { weights: {} },
      { weights: { ethos: 0 }, priority_dimensions: { add: 0 } },
    ]) {
      expect(
        request.parse(howDoesThisLandCatalogue(withBounds(bounds))).request.adjustment
      ).toBeNull();
    }
  });
});
