import { describe, expect, it } from 'vitest';
import { segmentParagraphs, type Annotation } from '@/components/app/design-lab/segments';
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

  it('takes marks in order of start, whatever order they arrive in', () => {
    const text = 'one two three';
    const two = ann(4, 7);
    const one = ann(0, 3);
    expect(segmentParagraphs(text, [two, one])).toEqual([
      [
        { text: 'one', annotation: one },
        { text: ' ' },
        { text: 'two', annotation: two },
        { text: ' three' },
      ],
    ]);
  });

  it('drops a mark that overlaps the one before it rather than repeating text', () => {
    const text = 'abcdefgh';
    const first = ann(0, 5);
    const overlapping = ann(3, 7);
    const runs = segmentParagraphs(text, [first, overlapping]).flat();
    expect(runs).toEqual([{ text: 'abcde', annotation: first }, { text: 'fgh' }]);
  });

  it('reproduces every annotated quote of the real sample exactly', () => {
    const runs = segmentParagraphs(SAMPLE.before.text, SAMPLE.before.annotations).flat();
    const marked = runs.filter((r) => r.annotation);
    expect(marked.map((r) => r.text)).toEqual(SAMPLE.before.annotations.map((a) => a.quote));
    // and nothing is lost or duplicated between the runs
    expect(runs.map((r) => r.text).join('')).toBe(SAMPLE.before.text.replace(/\n\n/g, ''));
  });
});
