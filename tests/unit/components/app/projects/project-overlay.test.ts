/**
 * The weights section's pure helpers (t-72).
 *
 * @see components/app/projects/project-overlay.ts
 */
import { describe, expect, it } from 'vitest';
import {
  coreDimensions,
  describeOverlay,
  movableAppeals,
  overlayBodyOf,
  storedOverlayReadable,
  weightsFormSchema,
  weightsIssues,
  weightsValuesOf,
} from '@/components/app/projects/project-overlay';
import { BOUNDS, aCatalogue, aProject } from '@/tests/unit/components/app/projects/fixtures';

const zero = { ethos: 0, pathos: 0, logos: 0, kairos: 0 };

describe('weightsValuesOf and overlayBodyOf', () => {
  it('reads a stored overlay as points and lists, and writes it back as shares', () => {
    const project = aProject({
      overlay: {
        weights: { ethos: 0.08, kairos: -0.05 },
        priorityDimensions: { add: ['kai_call'], remove: ['eth_goodwill'] },
      },
    });
    const values = weightsValuesOf(project);
    expect(values).toEqual({
      weights: { ethos: 8, pathos: 0, logos: 0, kairos: -5 },
      add: ['kai_call'],
      remove: ['eth_goodwill'],
    });
    expect(overlayBodyOf(values)).toEqual({ overlay: project.overlay });
  });

  it('reads no overlay, or one it cannot read, as nothing set', () => {
    const blank = { weights: zero, add: [], remove: [] };
    expect(weightsValuesOf(aProject())).toEqual(blank);
    expect(weightsValuesOf(aProject({ overlay: { weights: 'lots' } }))).toEqual(blank);
    expect(overlayBodyOf(blank)).toEqual({ overlay: null });
  });

  it('sends a removal alone', () => {
    expect(overlayBodyOf({ weights: zero, add: [], remove: ['eth_goodwill'] })).toEqual({
      overlay: { priorityDimensions: { remove: ['eth_goodwill'] } },
    });
  });
});

describe('precision (review round 1)', () => {
  it('saves an untouched stored delta back exactly', () => {
    const project = aProject({ overlay: { weights: { ethos: 0.12345, pathos: 0.07 } } });
    expect(overlayBodyOf(weightsValuesOf(project))).toEqual({ overlay: project.overlay });
  });

  it('holds a value to the exact bound, as the API does, not the rounded one shown', () => {
    const schema = weightsFormSchema({ ...BOUNDS, weights: { ...BOUNDS.weights, ethos: 0.0749 } });
    const at = (ethos: number) =>
      schema.safeParse({ weights: { ...zero, ethos }, add: [], remove: [] });
    expect(at(7.49).success).toBe(true);
    const over = at(7.5);
    expect(over.success).toBe(false);
    expect(over.success ? '' : over.error.issues[0]?.message).toBe('At most 7.5 either way');
  });
});

describe('storedOverlayReadable', () => {
  it('reads none and the engine’s shape, and not another', () => {
    expect(storedOverlayReadable(aProject())).toBe(true);
    expect(storedOverlayReadable(aProject({ overlay: { weights: { ethos: 0.1 } } }))).toBe(true);
    expect(storedOverlayReadable(aProject({ overlay: { weights: 'lots' } }))).toBe(false);
  });
});

describe('weightsFormSchema', () => {
  const schema = weightsFormSchema(BOUNDS);

  it('takes values within the bounds', () => {
    expect(
      schema.safeParse({ weights: { ...zero, ethos: -10 }, add: ['kai_call'], remove: [] }).success
    ).toBe(true);
  });

  it('refuses a fixed appeal moved, and too many ids', () => {
    const parsed = schema.safeParse({
      weights: { ...zero, logos: 1 },
      add: ['kai_call', 'eth_integrity'],
      remove: [],
    });
    const messages = parsed.success ? [] : parsed.error.issues.map((i) => i.message);
    expect(messages.sort()).toEqual([
      'Choose at most 1',
      'This model version does not let it move',
    ]);
  });

  it('refuses a dimension both added and removed', () => {
    const parsed = schema.safeParse({ weights: zero, add: ['kai_call'], remove: ['kai_call'] });
    expect(parsed.success ? [] : parsed.error.issues).toEqual([
      expect.objectContaining({
        path: ['remove'],
        message: 'A dimension cannot be both added and removed',
      }),
    ]);
  });
});

describe('weightsIssues', () => {
  it('places each path under its field, and keeps the rest for the summary', () => {
    expect(
      weightsIssues({
        issues: [
          { path: 'overlay.weights.pathos', message: 'a' },
          { path: 'overlay.priorityDimensions.add.0', message: 'b' },
          { path: 'overlay.priorityDimensions.remove', message: 'c' },
          { path: 'overlay.weights.vibes', message: 'd' },
          { path: 'overlay', message: 'e' },
        ],
      })
    ).toEqual({
      fields: [
        { field: 'weights.pathos', message: 'a' },
        { field: 'add', message: 'b' },
        { field: 'remove', message: 'c' },
      ],
      other: ['d', 'e'],
    });
  });

  it('is null for details it cannot read', () => {
    expect(weightsIssues(undefined)).toBeNull();
    expect(weightsIssues({ issues: 'no' })).toBeNull();
  });
});

describe('the catalogue helpers', () => {
  it('lists the core dimensions and the appeals that may move', () => {
    const catalogue = aCatalogue({ adjustment: BOUNDS });
    expect(coreDimensions(catalogue).map((d) => d.id)).toEqual([
      'eth_integrity',
      'eth_goodwill',
      'kai_call',
    ]);
    expect(movableAppeals(catalogue, BOUNDS)).toEqual([
      { id: 'ethos', name: 'Ethos', most: 10 },
      { id: 'pathos', name: 'Pathos', most: 5 },
    ]);
  });

  it('names an appeal or a dimension by id when the catalogue lacks it', () => {
    const catalogue = aCatalogue();
    const bare = { ...catalogue, result: { ...catalogue.result, appeals: [], dimensions: [] } };
    expect(movableAppeals(bare, BOUNDS).map((a) => a.name)).toEqual(['ethos', 'pathos']);
    expect(
      describeOverlay({ weights: { ...zero, ethos: 1 }, add: ['x'], remove: ['y'] }, bare)
    ).toEqual(['ethos +1 point', 'x made a priority', 'y no longer a priority']);
  });

  it('describes a stored adjustment in the catalogue’s names', () => {
    expect(
      describeOverlay(
        { weights: { ...zero, pathos: -5 }, add: ['kai_call'], remove: [] },
        aCatalogue()
      )
    ).toEqual(['Pathos −5 points', 'Call to action made a priority']);
  });
});
