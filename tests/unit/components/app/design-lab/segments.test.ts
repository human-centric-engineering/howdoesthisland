import { describe, expect, it } from 'vitest';
import { bandFor, segmentParagraphs, type Annotation } from '@/components/app/design-lab/segments';
import { SAMPLE } from '@/components/app/design-lab/sample';

function ann(start: number, end: number, change = 0): Annotation {
  return {
    ...SAMPLE.before.annotations[0],
    start,
    end,
    change,
  };
}

describe('segmentParagraphs', () => {
  it('splits on blank lines and keeps unmarked text whole', () => {
    expect(segmentParagraphs('One.\n\nTwo.', [])).toEqual([[{ text: 'One.' }], [{ text: 'Two.' }]]);
  });

  it('cuts a paragraph around a mark, using offsets into the whole text', () => {
    const text = 'Hi.\n\nAlpha beta gamma.';
    // "beta" sits at 11..15 in the whole text, 6..10 within its paragraph
    const mark = ann(11, 15);
    const [first, second] = segmentParagraphs(text, [mark]);
    expect(first).toEqual([{ text: 'Hi.' }]);
    expect(second).toEqual([
      { text: 'Alpha ' },
      { text: 'beta', annotation: mark },
      { text: ' gamma.' },
    ]);
  });

  it('clips a mark that runs across a paragraph break to each paragraph', () => {
    const text = 'abc\n\ndef';
    const mark = ann(1, 7);
    expect(segmentParagraphs(text, [mark])).toEqual([
      [{ text: 'a' }, { text: 'bc', annotation: mark }],
      [{ text: 'de', annotation: mark }, { text: 'f' }],
    ]);
  });

  it('reproduces every annotated quote of the real sample exactly', () => {
    const runs = segmentParagraphs(SAMPLE.before.text, SAMPLE.before.annotations).flat();
    const marked = runs.filter((r) => r.annotation);
    expect(marked.map((r) => r.text)).toEqual(SAMPLE.before.annotations.map((a) => a.quote));
    // and nothing is lost or duplicated between the runs
    expect(runs.map((r) => r.text).join('')).toBe(SAMPLE.before.text.replace(/\n\n/g, ''));
  });
});

describe('bandFor', () => {
  it.each([
    [0, 'Weak'],
    [39, 'Weak'],
    [40, 'Developing'],
    [74, 'Solid'],
    [75, 'Strong'],
    [100, 'Exceptional'],
  ])('puts %i in %s', (score, label) => {
    expect(bandFor(score, SAMPLE.bands)).toBe(label);
  });

  it('agrees with the band the engine assigned to the sample', () => {
    expect(bandFor(SAMPLE.before.scores.overall, SAMPLE.bands)).toBe(SAMPLE.before.scores.band);
    expect(bandFor(SAMPLE.after.scores.overall, SAMPLE.bands)).toBe(SAMPLE.after.scores.band);
  });
});
