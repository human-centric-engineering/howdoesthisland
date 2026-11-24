/**
 * Tests: a running review's quick scan (t-77).
 *
 * The route tests (`tests/unit/app/api/v1/assessments/routes.test.ts`) cover
 * it through the API with the real engine. These cover the ways it reads as
 * `null`, with `engineForVersion` replaced by a scripted engine.
 *
 * @see lib/app/assessments/early-scan.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ engineForVersion: vi.fn() }));
vi.mock('@/lib/app/assessments/engine', () => ({ engineForVersion: mocks.engineForVersion }));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: log }));

import {
  earlyQuickScan,
  forgetEarlyScansForTests,
  MEMO_LIMIT,
} from '@/lib/app/assessments/early-scan';

const INPUTS = {
  id: 'assessment-1',
  frameworkVersionId: 'version-1',
  context: { contentType: 'general' },
  overlay: null,
  text: 'Book a demo this week.',
  sourceUrl: null,
};

function scriptedEngine(over: Record<string, unknown> = {}) {
  const engine = {
    parseOverlay: vi.fn(() => ({ ok: true, overlay: null })),
    withOverlay: vi.fn(),
    quickScan: vi.fn(() => ({ quick: true })),
    assemble: vi.fn(() => ({ scores: { overall: 61, band: 'good' } })),
    ...over,
  };
  mocks.engineForVersion.mockResolvedValue({ engine });
  return engine;
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetEarlyScansForTests();
});

describe('earlyQuickScan', () => {
  it('answers the quick-scan result with its scores, assembled with no judges', async () => {
    const engine = scriptedEngine();
    expect(await earlyQuickScan(INPUTS)).toEqual({
      overall: 61,
      band: 'good',
      result: { scores: { overall: 61, band: 'good' } },
    });
    expect(engine.assemble).toHaveBeenCalledWith(
      INPUTS.text,
      INPUTS.context,
      { quick: true },
      {},
      null
    );
  });

  it('scores with the overlay when there is one', async () => {
    const adjusted = {
      quickScan: vi.fn(() => ({ adjusted: true })),
      assemble: vi.fn(() => ({ scores: { overall: 70, band: 'good' } })),
    };
    scriptedEngine({
      parseOverlay: vi.fn(() => ({ ok: true, overlay: { weights: { ethos: 0.1 } } })),
      withOverlay: vi.fn(() => adjusted),
    });
    expect(await earlyQuickScan({ ...INPUTS, overlay: { weights: { ethos: 0.1 } } })).toMatchObject(
      { overall: 70 }
    );
    expect(adjusted.assemble).toHaveBeenCalledWith(
      INPUTS.text,
      INPUTS.context,
      { adjusted: true },
      {},
      null
    );
  });

  it('answers null for a version no code runs', async () => {
    mocks.engineForVersion.mockResolvedValue(null);
    expect(await earlyQuickScan(INPUTS)).toBeNull();
  });

  it('answers null for an overlay that no longer fits, scoring nothing', async () => {
    const engine = scriptedEngine({
      parseOverlay: vi.fn(() => ({ ok: false, issues: [{ path: 'weights', message: 'no' }] })),
    });
    expect(await earlyQuickScan(INPUTS)).toBeNull();
    expect(engine.quickScan).not.toHaveBeenCalled();
  });

  it('answers null scores for a result that carries none', async () => {
    scriptedEngine({ assemble: vi.fn(() => ({})) });
    expect(await earlyQuickScan(INPUTS)).toEqual({ overall: null, band: null, result: {} });
  });

  it('answers null, and logs, when the engine throws something that is not an Error', async () => {
    scriptedEngine({
      quickScan: vi.fn(() => {
        // A non-Error throw is the case under test.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'cannot score';
      }),
    });
    expect(await earlyQuickScan(INPUTS)).toBeNull();
    expect(log.warn).toHaveBeenCalledWith('Could not work out a running review’s quick scan', {
      assessmentId: 'assessment-1',
      error: 'cannot score',
    });
  });

  it('throws when the version cannot be read, rather than calling the text unscorable', async () => {
    mocks.engineForVersion.mockRejectedValue(new Error('connection reset'));
    await expect(earlyQuickScan(INPUTS)).rejects.toThrow('connection reset');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('works each review out once: a second read scores nothing', async () => {
    const engine = scriptedEngine();
    const first = await earlyQuickScan(INPUTS);
    const second = await earlyQuickScan(INPUTS);
    expect(second).toEqual(first);
    expect(engine.quickScan).toHaveBeenCalledTimes(1);
    expect(mocks.engineForVersion).toHaveBeenCalledTimes(1);
  });

  it('keeps an unscorable answer too, so a polled review is not re-scored', async () => {
    const engine = scriptedEngine({
      quickScan: vi.fn(() => {
        throw new Error('cannot score');
      }),
    });
    expect(await earlyQuickScan(INPUTS)).toBeNull();
    expect(await earlyQuickScan(INPUTS)).toBeNull();
    expect(engine.quickScan).toHaveBeenCalledTimes(1);
  });

  it('drops the oldest answer once it holds its limit', async () => {
    const engine = scriptedEngine();
    for (let i = 0; i < MEMO_LIMIT; i += 1) await earlyQuickScan({ ...INPUTS, id: `a-${i}` });
    await earlyQuickScan({ ...INPUTS, id: 'one-more' });
    expect(engine.quickScan).toHaveBeenCalledTimes(MEMO_LIMIT + 1);

    // The newest are still kept; the first was dropped and is scored again.
    await earlyQuickScan({ ...INPUTS, id: `a-${MEMO_LIMIT - 1}` });
    expect(engine.quickScan).toHaveBeenCalledTimes(MEMO_LIMIT + 1);
    await earlyQuickScan({ ...INPUTS, id: 'a-0' });
    expect(engine.quickScan).toHaveBeenCalledTimes(MEMO_LIMIT + 2);
  });
});
