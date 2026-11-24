// @vitest-environment happy-dom

/**
 * A running review, live (t-78): `ReviewProgress` over `useReviewEvents`.
 *
 * Mocked: the browser's `EventSource` (`fake-event-source.ts`), driven
 * frame by frame as the server frames them. What is proved: the quick scan
 * shows at once, each AI reviewer as it lands and in the version's order,
 * a stream that times out is opened again and the replayed reviewers do not
 * double, the review being final closes the stream and calls `onDone`
 * once, and a stream that keeps failing is reported lost with a way to try
 * again.
 *
 * @see components/app/workbench/review-progress.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ReviewProgress } from '@/components/app/workbench/review-progress';
import { MAX_RETRIES, RETRY_MS } from '@/components/app/workbench/use-review-events';
import { FakeEventSource } from '@/tests/unit/components/app/workbench/fake-event-source';
import { QUICK_RESULT } from '@/tests/unit/components/app/workbench/fixtures';

const REVIEWERS = [
  { slot: 'judge_ethos', name: 'Ethos' },
  { slot: 'judge_pathos', name: 'Pathos' },
  { slot: 'judge_craft', name: 'Craft' },
];
const APPEALS = { ethos: 'Ethos', pathos: 'Pathos', logos: 'Logos', kairos: 'Kairos' };

function renderProgress(overrides: Partial<React.ComponentProps<typeof ReviewProgress>> = {}): {
  onDone: ReturnType<typeof vi.fn>;
} {
  const onDone = vi.fn();
  render(
    <ReviewProgress
      assessmentId="a-1"
      reviewers={REVIEWERS}
      appealNames={APPEALS}
      initial={{ status: 'running', quickScan: null, runs: [] }}
      onDone={onDone}
      {...overrides}
    />
  );
  return { onDone };
}

/** Each reviewer row's name and state, in the order shown. */
function rows(): Array<[string, string | null]> {
  return within(screen.getByTestId('review-reviewers'))
    .getAllByRole('listitem')
    .map((li) => [li.querySelector('.font-semibold')?.textContent ?? '', li.dataset.state ?? null]);
}

const judge = (slot: string, status: 'succeeded' | 'failed' = 'succeeded') => ({
  type: 'assessment_judge',
  id: 'a-1',
  judge: slot,
  status,
  model: 'm',
  costUsd: 0.01,
  latencyMs: 900,
  errorCode: status === 'failed' ? 'TIMEOUT' : null,
});

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ReviewProgress', () => {
  it('follows the review’s own event stream', () => {
    renderProgress();
    expect(FakeEventSource.latest().url).toBe('/api/v1/assessments/a-1/events');
  });

  it('shows the quick scan it was started with at once, beside its caveat', () => {
    renderProgress({
      initial: {
        status: 'running',
        quickScan: { overall: 58, band: 'Mixed', result: QUICK_RESULT },
        runs: [],
      },
    });

    const scan = screen.getByTestId('review-quick-scan');
    expect(within(scan).getByText('58')).toBeInTheDocument();
    expect(within(scan).getByText('Mixed')).toBeInTheDocument();
    expect(within(scan).getByText('Logos')).toBeInTheDocument();
    expect(within(scan).getByText('70')).toBeInTheDocument();
    expect(within(scan).getByTestId('quick-scan-caveat')).toHaveTextContent(/without AI/);
  });

  it('shows the quick scan the stream sends when it had none', () => {
    renderProgress();
    expect(screen.queryByTestId('review-quick-scan')).not.toBeInTheDocument();

    act(() =>
      FakeEventSource.latest().emit({
        type: 'assessment_quick_scan',
        id: 'a-1',
        overall: 44,
        band: 'Weak',
        result: QUICK_RESULT,
      })
    );

    expect(within(screen.getByTestId('review-quick-scan')).getByText('44')).toBeInTheDocument();
  });

  it('marks each AI reviewer as it lands, keeping the version’s order', () => {
    renderProgress();
    expect(rows()).toEqual([
      ['Ethos', 'waiting'],
      ['Pathos', 'waiting'],
      ['Craft', 'waiting'],
    ]);
    expect(screen.getByText(/0 of 3 AI reviewers have finished/)).toBeInTheDocument();

    const stream = FakeEventSource.latest();
    act(() => stream.emit(judge('judge_craft')));
    act(() => stream.emit(judge('judge_ethos', 'failed')));

    expect(rows()).toEqual([
      ['Ethos', 'failed'],
      ['Pathos', 'waiting'],
      ['Craft', 'succeeded'],
    ]);
    expect(screen.getByText(/2 of 3 AI reviewers have finished/)).toBeInTheDocument();
    expect(screen.getByText(/its scores come from the quick scan/)).toBeInTheDocument();
  });

  it('starts from the reviewers that had already landed', () => {
    renderProgress({
      initial: {
        status: 'running',
        quickScan: null,
        runs: [{ judge: 'judge_pathos', status: 'succeeded', errorCode: null }],
      },
    });
    expect(rows()[1]).toEqual(['Pathos', 'succeeded']);
  });

  it('opens the stream again when it times out, without doubling the replayed reviewers', () => {
    renderProgress();
    const first = FakeEventSource.latest();
    act(() => first.emit(judge('judge_ethos')));
    act(() => first.emit({ type: 'assessment_timeout', id: 'a-1' }));

    expect(first.closed).toBe(true);
    expect(FakeEventSource.opened).toHaveLength(2);
    const second = FakeEventSource.latest();
    expect(second.closed).toBe(false);

    // A stream opened late replays what has landed, then carries on.
    act(() => second.emit({ type: 'assessment_status', id: 'a-1', status: 'running' }));
    act(() => second.emit(judge('judge_ethos')));
    act(() => second.emit(judge('judge_pathos')));

    expect(rows()).toEqual([
      ['Ethos', 'succeeded'],
      ['Pathos', 'succeeded'],
      ['Craft', 'waiting'],
    ]);
  });

  it('closes the stream and calls onDone once the review is final', () => {
    const { onDone } = renderProgress();
    const stream = FakeEventSource.latest();

    act(() =>
      stream.emit({
        type: 'assessment_done',
        id: 'a-1',
        status: 'partial',
        overall: 60,
        band: 'Mixed',
        costUsd: 0.2,
        error: null,
        errorCode: null,
      })
    );

    expect(stream.closed).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith('partial');
    expect(FakeEventSource.opened).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Opening the report');
  });

  it('says so when the review is deleted, and opens no other stream', () => {
    const { onDone } = renderProgress();
    const stream = FakeEventSource.latest();

    act(() => stream.emit({ type: 'assessment_gone', id: 'a-1' }));

    expect(stream.closed).toBe(true);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/has been deleted/);
    expect(FakeEventSource.opened).toHaveLength(1);
  });

  it('ignores a frame it cannot read', () => {
    renderProgress();
    act(() => FakeEventSource.latest().emitRaw('assessment_judge', 'not json'));
    expect(rows().every(([, state]) => state === 'waiting')).toBe(true);
  });

  it('shows reconnecting while the browser recovers the stream itself', () => {
    renderProgress();
    const stream = FakeEventSource.latest();

    act(() => stream.fail('connecting'));
    expect(screen.getByRole('status')).toHaveTextContent(/Reconnecting/);
    // The browser reconnects this one: no stream of the page's own.
    expect(FakeEventSource.opened).toHaveLength(1);

    act(() => stream.open());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('retries a stream the browser gave up on, then reports it lost, and tries again on request', async () => {
    vi.useFakeTimers();
    renderProgress();

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      act(() => FakeEventSource.latest().fail('closed'));
      expect(screen.getByRole('status')).toHaveTextContent(/Reconnecting/);
      act(() => {
        vi.advanceTimersByTime(RETRY_MS * attempt);
      });
      expect(FakeEventSource.opened).toHaveLength(attempt + 1);
    }
    act(() => FakeEventSource.latest().fail('closed'));

    expect(screen.getByRole('status')).toHaveTextContent(/lost touch with the review/);
    expect(FakeEventSource.opened).toHaveLength(MAX_RETRIES + 1);

    vi.useRealTimers();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(FakeEventSource.opened).toHaveLength(MAX_RETRIES + 2);
    expect(FakeEventSource.latest().closed).toBe(false);
  });

  it('closes its stream when it is taken off the page', () => {
    const { unmount } = render(
      <ReviewProgress
        assessmentId="a-1"
        reviewers={REVIEWERS}
        appealNames={APPEALS}
        initial={{ status: 'queued', quickScan: null, runs: [] }}
        onDone={vi.fn()}
      />
    );
    unmount();
    expect(FakeEventSource.latest().closed).toBe(true);
  });
});
