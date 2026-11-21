/**
 * Tests: the landing page's self-score (t-62).
 *
 * Off, it must not reach the quick scan at all: "no quick-scan output or
 * call" is the switch's promise for the public site. On, it maps the scan's
 * result to the panel's figures, and a failure falls back to `null` so the
 * landing page still renders.
 *
 * @see lib/app/quick-scan/self-score.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'test',
  QUICK_SCAN_ENABLED: undefined as boolean | undefined,
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const runQuickScan = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/assessments/api/scan', () => ({ runQuickScan }));

vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { selfScore } from '@/lib/app/quick-scan/self-score';
import { logger } from '@/lib/logging';

const CONTEXT = { contentType: 'landing_page' };

function scanView(scores: Record<string, unknown>) {
  return {
    framework: { slug: 'howdoesthisland', version: '0.5.1' },
    wordCount: 400,
    overall: scores.overall,
    band: scores.band,
    context: CONTEXT,
    result: { scores },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.QUICK_SCAN_ENABLED = true;
});

describe('selfScore', () => {
  it('with the switch off, answers null without calling the quick scan', async () => {
    mockEnv.QUICK_SCAN_ENABLED = false;
    await expect(selfScore('Some copy.', CONTEXT)).resolves.toBeNull();
    expect(runQuickScan).not.toHaveBeenCalled();
  });

  it('with the switch on, scores the text it is given in the context it is given', async () => {
    runQuickScan.mockResolvedValue(
      scanView({ overall: 63, band: 'Solid', ethos: 71, pathos: 50, logos: 73, kairos: 69 })
    );

    const score = await selfScore('The page’s copy.', CONTEXT);

    expect(runQuickScan).toHaveBeenCalledWith({ text: 'The page’s copy.', context: CONTEXT });
    expect(score).toEqual({
      overall: 63,
      band: 'Solid',
      appeals: [
        { id: 'ethos', score: 71 },
        { id: 'pathos', score: 50 },
        { id: 'logos', score: 73 },
        { id: 'kairos', score: 69 },
      ],
      weakest: 'pathos',
      scoredWith: 'howdoesthisland@0.5.1',
    });
  });

  it('names the first of the lowest appeals on a tie', async () => {
    runQuickScan.mockResolvedValue(
      scanView({ overall: 40, band: 'Developing', ethos: 60, pathos: 30, logos: 30, kairos: 50 })
    );
    expect((await selfScore('x', CONTEXT))?.weakest).toBe('pathos');
  });

  it('answers null, and logs, when the quick scan throws', async () => {
    runQuickScan.mockRejectedValue(new Error('howdoesthisland has no published version.'));
    await expect(selfScore('x', CONTEXT)).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('Self-score could not run', {
      error: 'howdoesthisland has no published version.',
    });
  });

  it('answers null when the result has no appeal scores', async () => {
    runQuickScan.mockResolvedValue(scanView({ overall: 63, band: 'Solid' }));
    await expect(selfScore('x', CONTEXT)).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'Self-score result has no appeal scores',
      expect.objectContaining({ issues: expect.any(Array) })
    );
  });
});
