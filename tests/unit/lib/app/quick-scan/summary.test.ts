/**
 * Tests: what a signed-out caller gets from the quick scan (t-68).
 *
 * @see lib/app/quick-scan/summary.ts
 */
import { describe, expect, it } from 'vitest';
import {
  QUICK_SCAN_CAVEAT,
  quickScanSummarySchema,
  summariseQuickScan,
} from '@/lib/app/quick-scan/summary';
import type { QuickScanView } from '@/lib/app/assessments/api/views';

const view = (result: unknown): QuickScanView => ({
  framework: { slug: 'howdoesthisland', version: '0.5.1' },
  wordCount: 9,
  overall: 51,
  band: 'Developing',
  context: { contentType: 'general' },
  result,
});

describe('summariseQuickScan', () => {
  it('keeps the scores, in the order of the version’s appeals, and the caveat, and drops the rest', () => {
    const summary = summariseQuickScan(
      view({
        effective_weights: { logos: 0.3, ethos: 0.3 },
        scores: { overall: 51, band: 'Developing', ethos: 60, logos: 44, balance_index: 80 },
        highlights: [{ quote: 'hype', note: 'a pattern matched' }],
      })
    );
    expect(summary).toEqual({
      framework: { slug: 'howdoesthisland', version: '0.5.1' },
      wordCount: 9,
      overall: 51,
      band: 'Developing',
      appeals: [
        { id: 'logos', score: 44 },
        { id: 'ethos', score: 60 },
      ],
      caveat: QUICK_SCAN_CAVEAT,
    });
    expect(quickScanSummarySchema.parse(summary)).toEqual(summary);
  });

  it('leaves out an appeal with no number, and answers no appeals for a result it cannot read', () => {
    expect(
      summariseQuickScan(view({ effective_weights: { ethos: 1 }, scores: { ethos: 'n/a' } }))
        .appeals
    ).toEqual([]);
    expect(summariseQuickScan(view(null)).appeals).toEqual([]);
    expect(summariseQuickScan(view({ scores: {} })).caveat).toBe(QUICK_SCAN_CAVEAT);
  });
});
