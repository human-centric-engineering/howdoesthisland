import type { Sample } from '@/components/app/design-lab/sample';

type SampleAnnotation = Sample['before']['annotations'][number];

/** A sample annotation with its offsets widened from the sample's literals. */
export type Annotation = Omit<SampleAnnotation, 'start' | 'end' | 'change'> & {
  start: number;
  end: number;
  change: number;
};

export interface Segment {
  text: string;
  annotation?: Annotation;
}

/**
 * Split a text into paragraphs, and each paragraph into runs that either carry
 * one annotation or none. Annotations are offsets into the whole text, taken in
 * order of start; one that overlaps an earlier one is dropped rather than
 * duplicating text.
 */
export function segmentParagraphs(text: string, annotations: readonly Annotation[]): Segment[][] {
  const ordered = [...annotations].sort((a, b) => a.start - b.start);
  const paragraphs: Segment[][] = [];
  let offset = 0;
  for (const para of text.split('\n\n')) {
    const start = offset;
    const end = start + para.length;
    const runs: Segment[] = [];
    let cursor = start;
    for (const a of ordered) {
      if (a.end <= start || a.start >= end) continue;
      const from = Math.max(a.start, start);
      if (from < cursor) continue; // overlaps the mark before it
      const to = Math.min(a.end, end);
      if (from > cursor) runs.push({ text: text.slice(cursor, from) });
      runs.push({ text: text.slice(from, to), annotation: a });
      cursor = to;
    }
    if (cursor < end) runs.push({ text: text.slice(cursor, end) });
    paragraphs.push(runs);
    offset = end + 2;
  }
  return paragraphs;
}
