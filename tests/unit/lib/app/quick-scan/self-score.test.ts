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
let LOOKUP_TTL_MS: number;
let TIMEOUT_MS: number;
let ABANDON_AFTER_MS: number;

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
  ({ selfScore, RETRY_FAILED_MS, LOOKUP_TTL_MS, TIMEOUT_MS, ABANDON_AFTER_MS } =
    await import('@/lib/app/quick-scan/self-score'));
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

const V52 = served(
  { id: 'v52', version: '0.5.2', status: 'PUBLISHED' },
  { id: 'v51', version: '0.5.1', status: 'PUBLISHED' }
);

describe('selfScore, kept per framework version', () => {
  it('scores once, and looks the version up once, for many views within the lookup window', async () => {
    runQuickScan.mockResolvedValue(scanView(SOLID));
    const first = await selfScore('copy', CONTEXT);
    const again = await Promise.all([selfScore('copy', CONTEXT), selfScore('copy', CONTEXT)]);

    expect(again).toEqual([first, first]);
    expect(runQuickScan).toHaveBeenCalledTimes(1);
    expect(findFramework).toHaveBeenCalledTimes(1);
  });

  it('shares one lookup and one scan between concurrent first views', async () => {
    runQuickScan.mockResolvedValue(scanView(SOLID));
    await Promise.all([selfScore('copy', CONTEXT), selfScore('copy', CONTEXT)]);
    expect(findFramework).toHaveBeenCalledTimes(1);
    expect(runQuickScan).toHaveBeenCalledTimes(1);
  });

  it('looks the version up again after the lookup window, and rescores a newly published one', async () => {
    vi.useFakeTimers();
    runQuickScan.mockResolvedValue(scanView(SOLID));
    await selfScore('copy', CONTEXT);
    findFramework.mockResolvedValue(V52);

    // Still within the window: the old version answers.
    await selfScore('copy', CONTEXT);
    expect(findFramework).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(LOOKUP_TTL_MS);
    await selfScore('copy', CONTEXT);
    expect(findFramework).toHaveBeenCalledTimes(2);
    expect(runQuickScan).toHaveBeenCalledTimes(2);
    expect(runQuickScan).toHaveBeenLastCalledWith({
      text: 'copy',
      context: CONTEXT,
      version: '0.5.2',
    });
  });

  it('does not rescore when the lookup finds the same version again', async () => {
    vi.useFakeTimers();
    runQuickScan.mockResolvedValue(scanView(SOLID));
    await selfScore('copy', CONTEXT);
    vi.advanceTimersByTime(LOOKUP_TTL_MS);
    await selfScore('copy', CONTEXT);
    expect(findFramework).toHaveBeenCalledTimes(2);
    expect(runQuickScan).toHaveBeenCalledTimes(1);
  });

  it('scores again when the copy or the context changes', async () => {
    runQuickScan.mockResolvedValue(scanView(SOLID));
    await selfScore('copy', CONTEXT);
    await selfScore('new copy', CONTEXT);
    await selfScore('new copy', { contentType: 'pitch' });
    expect(runQuickScan).toHaveBeenCalledTimes(3);
  });

  it('retries a failed scan only after the retry window, and logs a lasting one once', async () => {
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

  it('logs a scan failure again after the scan has recovered', async () => {
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

  it('answers null when a scan stalls, and does not hold later views on it', async () => {
    vi.useFakeTimers();
    runQuickScan.mockReturnValue(new Promise(() => {}));

    const first = selfScore('copy', CONTEXT);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await expect(first).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('Self-score scan timed out', { afterMs: TIMEOUT_MS });

    // A later view answers at once from the timed-out run.
    await expect(selfScore('copy', CONTEXT)).resolves.toBeNull();
    expect(runQuickScan).toHaveBeenCalledTimes(1);
  });

  it('starts no second scan beside a stalled one until it looks abandoned', async () => {
    vi.useFakeTimers();
    runQuickScan.mockReturnValue(new Promise(() => {}));
    const first = selfScore('copy', CONTEXT);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await first;

    // Past the retry window, but the first run is still going.
    vi.advanceTimersByTime(RETRY_FAILED_MS);
    await selfScore('copy', CONTEXT);
    expect(runQuickScan).toHaveBeenCalledTimes(1);

    runQuickScan.mockResolvedValue(scanView(SOLID));
    vi.advanceTimersByTime(ABANDON_AFTER_MS);
    await expect(selfScore('copy', CONTEXT)).resolves.toMatchObject({ overall: 63 });
    expect(runQuickScan).toHaveBeenCalledTimes(2);
  });

  it('retries a failed scan once its run has settled', async () => {
    vi.useFakeTimers();
    let settle: (v: unknown) => void = () => {};
    runQuickScan.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    const first = selfScore('copy', CONTEXT);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await first;
    // The slow run finishes late; its answer came too late for the view.
    settle(scanView(SOLID));
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(RETRY_FAILED_MS);
    runQuickScan.mockResolvedValue(scanView(SOLID));
    await expect(selfScore('copy', CONTEXT)).resolves.toMatchObject({ overall: 63 });
    expect(runQuickScan).toHaveBeenCalledTimes(2);
  });

  it('answers null when a lookup stalls, and does not hold later views on it', async () => {
    vi.useFakeTimers();
    findFramework.mockReturnValue(new Promise(() => {}));
    const first = selfScore('copy', CONTEXT);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await expect(first).resolves.toBeNull();
    await expect(selfScore('copy', CONTEXT)).resolves.toBeNull();
    expect(findFramework).toHaveBeenCalledTimes(1);
    expect(runQuickScan).not.toHaveBeenCalled();
  });

  it('does not ask the database again within the retry window after a lookup fails', async () => {
    vi.useFakeTimers();
    findFramework.mockRejectedValue(new Error('connection refused'));
    await selfScore('copy', CONTEXT);
    await selfScore('copy', CONTEXT);
    expect(findFramework).toHaveBeenCalledTimes(1);

    findFramework.mockResolvedValue(served({ id: 'v51', version: '0.5.1', status: 'PUBLISHED' }));
    runQuickScan.mockResolvedValue(scanView(SOLID));
    vi.advanceTimersByTime(RETRY_FAILED_MS);
    await expect(selfScore('copy', CONTEXT)).resolves.toMatchObject({ overall: 63 });
    expect(findFramework).toHaveBeenCalledTimes(2);
  });

  it('shows the last good score while the lookup is failing', async () => {
    vi.useFakeTimers();
    runQuickScan.mockResolvedValue(scanView(SOLID));
    const good = await selfScore('copy', CONTEXT);

    findFramework.mockRejectedValue(new Error('connection refused'));
    vi.advanceTimersByTime(LOOKUP_TTL_MS);
    await expect(selfScore('copy', CONTEXT)).resolves.toEqual(good);
    await expect(selfScore('copy', CONTEXT)).resolves.toEqual(good);
    expect(runQuickScan).toHaveBeenCalledTimes(1);
  });

  it('logs a repeat lookup failure after the lookup has recovered', async () => {
    vi.useFakeTimers();
    runQuickScan.mockResolvedValue(scanView(SOLID));
    await selfScore('copy', CONTEXT);

    findFramework.mockRejectedValueOnce(new Error('connection refused'));
    vi.advanceTimersByTime(LOOKUP_TTL_MS);
    await selfScore('copy', CONTEXT);
    vi.advanceTimersByTime(RETRY_FAILED_MS);
    await selfScore('copy', CONTEXT); // recovered
    expect(runQuickScan).toHaveBeenCalledTimes(1);

    findFramework.mockRejectedValueOnce(new Error('connection refused'));
    vi.advanceTimersByTime(LOOKUP_TTL_MS);
    await selfScore('copy', CONTEXT);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
