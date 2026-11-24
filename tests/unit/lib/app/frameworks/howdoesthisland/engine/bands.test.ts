/**
 * Bands cover every overall score once (t-79 review). The engine rounds
 * `overall` before `bandOf` reads it, so whole-number bands from 0 to 100,
 * each starting where the last ended, leave no score without a band. The
 * framework definition refuses any other set where a version comes in; the
 * engine still reads one stored before that check.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { indexModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import { bandOf } from '@/lib/app/frameworks/howdoesthisland/engine/scoring';
import { checkBands, scoringSchema } from '@/lib/app/frameworks/howdoesthisland/schemas';

const DATA = 'lib/app/frameworks/howdoesthisland/data';
const read = (file: string): Record<string, unknown> =>
  z.looseObject({}).parse(JSON.parse(readFileSync(`${DATA}/${file}`, 'utf8')));

const bands = z
  .array(z.object({ min: z.number(), max: z.number(), label: z.string() }))
  .superRefine(checkBands);

const SHIPPED = [
  { min: 0, max: 39, label: 'Weak' },
  { min: 40, max: 59, label: 'Developing' },
  { min: 60, max: 74, label: 'Solid' },
  { min: 75, max: 89, label: 'Strong' },
  { min: 90, max: 100, label: 'Exceptional' },
];

const messageFor = (value: unknown) => {
  const result = bands.safeParse(value);
  return result.success ? null : result.error.issues.map((i) => i.message);
};

describe('checkBands', () => {
  it('accepts whole-number bands from 0 to 100 with no gap, in any order', () => {
    expect(messageFor(SHIPPED)).toBeNull();
    expect(messageFor([...SHIPPED].reverse())).toBeNull();
    expect(messageFor([{ min: 0, max: 100, label: 'All' }])).toBeNull();
  });

  it.each([
    [
      'a gap',
      [SHIPPED[0], { ...SHIPPED[1], min: 41 }, ...SHIPPED.slice(2)],
      'No band covers 40–40',
    ],
    [
      'an overlap',
      [SHIPPED[0], { ...SHIPPED[1], min: 39 }, ...SHIPPED.slice(2)],
      'Bands overlap: 0–39 and 39–59',
    ],
    [
      'a fractional limit',
      [{ ...SHIPPED[0], max: 39.5 }, ...SHIPPED.slice(1)],
      'Band limits must be whole numbers, since overall scores are',
    ],
    ['a first band above 0', SHIPPED.slice(1), 'The lowest band must start at 0, not 40'],
    ['a last band short of 100', SHIPPED.slice(0, -1), 'The highest band must end at 100, not 89'],
    [
      'a band running backwards',
      [
        { min: 0, max: 50, label: 'A' },
        { min: 51, max: 40, label: 'B' },
      ],
      'A band runs from 51 down to 40',
    ],
    ['no bands', [], 'Declare at least one band'],
    [
      'an empty label',
      [
        { min: 0, max: 49, label: 'Weak' },
        { min: 50, max: 100, label: ' ' },
      ],
      "Band labels need 1 to 64 characters, as the band filter takes; ' ' has 1",
    ],
    [
      'a label the band filter would refuse',
      [{ min: 0, max: 100, label: 'x'.repeat(65) }],
      `Band labels need 1 to 64 characters, as the band filter takes; '${'x'.repeat(65)}' has 65`,
    ],
    [
      'two bands with one label',
      [
        { min: 0, max: 49, label: 'Weak' },
        { min: 50, max: 100, label: 'Weak' },
      ],
      "Two bands are labelled 'Weak'; a band filter could not tell them apart",
    ],
  ])('refuses %s', (_name, value, message) => {
    expect(messageFor(value)).toEqual([message]);
  });

  it.each(['model-0.5.1.json', 'model-0.5.2.json'])(
    'passes %s, which then gives every score from 0 to 100 a band',
    (file) => {
      const model = read(file);
      expect(scoringSchema.safeParse(model.scoring).success).toBe(true);
      const m = indexModel(model);
      for (let v = 0; v <= 100; v++) expect(bandOf(m, v)).not.toBe('');
    }
  );

  it('is refused where a version comes in, while the engine still reads one stored before', () => {
    const model = read('model-0.5.2.json');
    const scoring = z.looseObject({}).parse(model.scoring);
    const gapped = { ...scoring, bands: SHIPPED.filter((b) => b.label !== 'Developing') };

    const result = scoringSchema.safeParse(gapped);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual(['No band covers 40–59']);
    const m = indexModel({ ...model, scoring: gapped });
    expect(bandOf(m, 50)).toBe('');
    expect(bandOf(m, 75)).toBe('Strong');
  });
});
