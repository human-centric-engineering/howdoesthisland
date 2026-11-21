/**
 * Tests: the landing page's self-score (t-62).
 *
 * Off, it must not reach the quick scan at all: "no quick-scan output or
 * call" is the switch's promise for the public site. On, it maps the scan's
 * result to the panel's figures, and a failure falls back to `null` so the
 * landing page still renders. The score is kept per published framework
 * version, so page views do not rerun the engine, and a lasting failure is
 * logged once, not per view.
 *
 * @see lib/app/quick-scan/self-score.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'test',
  QUICK_SCAN_ENABLED: undefined as boolean | undefined,
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const runQuickScan = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/assessments/api/scan', () => ({ runQuickScan }));

const findFramework = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/frameworks/api/catalog', () => ({
  prismaFrameworkCatalog: { findFramework },
}));

const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger }));

type SelfScoreModule = typeof import('@/lib/app/quick-scan/self-score');
let selfScore: SelfScoreModule['selfScore'];
let RETRY_FAILED_MS: number;

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

/** The framework as the catalog serves it: newest version first. */
function served(...versions: { id: string; version: string; status: string }[]) {
  return {
    slug: 'howdoesthisland',
    versions: versions.map((v) => ({ ...v, sourceSha256: `sha-${v.id}` })),
  };
}

const SOLID = { overall: 63, band: 'Solid', ethos: 71, pathos: 50, logos: 73, kairos: 69 };

beforeEach(async () => {
  vi.clearAllMocks();
  mockEnv.QUICK_SCAN_ENABLED = true;
  findFramework.mockResolvedValue(served({ id: 'v51', version: '0.5.1', status: 'PUBLISHED' }));
  // The score is kept in module state: each test starts with none.
  vi.resetModules();
  ({ selfScore, RETRY_FAILED_MS } = await import('@/lib/app/quick-scan/self-score'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('selfScore', () => {
  it('with the switch off, answers null without calling the quick scan', async () => {
    mockEnv.QUICK_SCAN_ENABLED = false;
    await expect(selfScore('Some copy.', CONTEXT)).resolves.toBeNull();
    expect(runQuickScan).not.toHaveBeenCalled();
    expect(findFramework).not.toHaveBeenCalled();
  });

  it('with the switch on, scores the text it is given in the context it is given', async () => {
    runQuickScan.mockResolvedValue(
      scanView({ overall: 63, band: 'Solid', ethos: 71, pathos: 50, logos: 73, kairos: 69 })
    );

    const score = await selfScore('The page’s copy.', CONTEXT);

    expect(runQuickScan).toHaveBeenCalledWith({
      text: 'The page’s copy.',
      context: CONTEXT,
      version: '0.5.1',
    });
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

  it('answers null, and logs, when the framework has no published version, without scanning', async () => {
    findFramework.mockResolvedValue(served({ id: 'v50', version: '0.5.0', status: 'RETIRED' }));
    await expect(selfScore('x', CONTEXT)).resolves.toBeNull();
    expect(runQuickScan).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Self-score could not run', {
      error: 'howdoesthisland has no published version.',
    });
  });

  it('answers null when the framework lookup throws', async () => {
    findFramework.mockRejectedValue(new Error('connection refused'));
    await expect(selfScore('x', CONTEXT)).resolves.toBeNull();
    expect(runQuickScan).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Self-score could not run', {
      error: 'connection refused',
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

describe('selfScore, kept per framework version', () => {
  it('scores once for many page views of the same copy and version', async () => {
    runQuickScan.mockResolvedValue(scanView(SOLID));
    const first = await selfScore('copy', CONTEXT);
    const again = await Promise.all([selfScore('copy', CONTEXT), selfScore('copy', CONTEXT)]);

    expect(runQuickScan).toHaveBeenCalledTimes(1);
    expect(again).toEqual([first, first]);
    // Each view still checks which version is the latest.
    expect(findFramework).toHaveBeenCalledTimes(3);
  });

  it('runs one scan for concurrent first views', async () => {
    runQuickScan.mockResolvedValue(scanView(SOLID));
    await Promise.all([selfScore('copy', CONTEXT), selfScore('copy', CONTEXT)]);
    expect(runQuickScan).toHaveBeenCalledTimes(1);
  });

  it('scores again when a new version is published', async () => {
    runQuickScan.mockResolvedValue(scanView(SOLID));
    await selfScore('copy', CONTEXT);
    findFramework.mockResolvedValue(
      served(
        { id: 'v52', version: '0.5.2', status: 'PUBLISHED' },
        { id: 'v51', version: '0.5.1', status: 'PUBLISHED' }
      )
    );
    await selfScore('copy', CONTEXT);

    expect(runQuickScan).toHaveBeenCalledTimes(2);
    expect(runQuickScan).toHaveBeenLastCalledWith({
      text: 'copy',
      context: CONTEXT,
      version: '0.5.2',
    });
  });

  it('scores again when the copy or the context changes', async () => {
    runQuickScan.mockResolvedValue(scanView(SOLID));
    await selfScore('copy', CONTEXT);
    await selfScore('new copy', CONTEXT);
    await selfScore('new copy', { contentType: 'pitch' });
    expect(runQuickScan).toHaveBeenCalledTimes(3);
  });

  it('retries a failure only after the retry window, and logs a lasting one once', async () => {
    vi.useFakeTimers();
    runQuickScan.mockRejectedValue(new Error('scan refused'));

    await selfScore('copy', CONTEXT);
    await selfScore('copy', CONTEXT);
    expect(runQuickScan).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(RETRY_FAILED_MS);
    await expect(selfScore('copy', CONTEXT)).resolves.toBeNull();
    expect(runQuickScan).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    runQuickScan.mockResolvedValue(scanView(SOLID));
    vi.advanceTimersByTime(RETRY_FAILED_MS);
    await expect(selfScore('copy', CONTEXT)).resolves.toMatchObject({ overall: 63 });
    expect(runQuickScan).toHaveBeenCalledTimes(3);
  });

  it('logs a failure again after the score has recovered', async () => {
    vi.useFakeTimers();
    runQuickScan.mockRejectedValue(new Error('scan refused'));
    await selfScore('copy', CONTEXT);
    runQuickScan.mockResolvedValue(scanView(SOLID));
    vi.advanceTimersByTime(RETRY_FAILED_MS);
    await selfScore('copy', CONTEXT);
    runQuickScan.mockRejectedValue(new Error('scan refused'));
    await selfScore('other copy', CONTEXT);

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
