import type { Sample } from '@/components/app/design-lab/sample';

export type Annotation = Sample['before']['annotations'][number];

export interface Segment {
  text: string;
  annotation?: Annotation;
}

/**
 * Split a text into paragraphs, and each paragraph into runs that either carry
 * one annotation or none. Annotations are offsets into the whole text and do
 * not overlap (the generator drops overlaps).
 */
export function segmentParagraphs(text: string, annotations: readonly Annotation[]): Segment[][] {
  const paragraphs: Segment[][] = [];
  let offset = 0;
  for (const para of text.split('\n\n')) {
    const start = offset;
    const end = start + para.length;
    const runs: Segment[] = [];
    let cursor = start;
    for (const a of annotations) {
      if (a.end <= start || a.start >= end) continue;
      const from = Math.max(a.start, start);
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

export function bandFor(score: number, bands: Sample['bands']): string {
  return bands.find((b) => score >= b.min && score <= b.max)?.label ?? '';
}
