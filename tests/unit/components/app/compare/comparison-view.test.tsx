// @vitest-environment happy-dom

/**
 * `/compare/[id]`'s comparison (t-89).
 *
 * Mocked: the API client, which the view reads the comparison again through
 * while it moves. What is proved: each draft's scores sit side by side, the
 * best on each appeal is marked (both, on a tie) and the rest say how far
 * behind; the editor's verdict names the draft that lands better and why,
 * and every other verdict state says what it means; a failed, partial or
 * purged draft keeps its column and says so; a running comparison is read
 * again until it has ended, and says when it cannot be.
 *
 * @see components/app/compare/comparison-view.tsx
 * @see components/app/compare/use-comparison.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { ComparisonView } from '@/components/app/compare/comparison-view';
import { comparisonSchema } from '@/components/app/compare/schemas';
import { MAX_MISSES, POLL_MS } from '@/components/app/compare/use-comparison';
import { APIClientError, apiClient } from '@/lib/api/client';
import {
  APPEAL_NAMES,
  aComparison,
  aRunningComparison,
} from '@/tests/unit/components/app/compare/fixtures';

function renderView(wire: unknown) {
  return render(
    <ComparisonView comparison={comparisonSchema.parse(wire)} appealNames={APPEAL_NAMES} />
  );
}

/** The cell for a draft (by its column heading) on a row (by its heading). */
function cell(row: string, draft: string): HTMLElement {
  const table = screen.getByRole('table');
  const headers = within(table).getAllByRole('columnheader');
  const col = headers.findIndex((h) => h.textContent?.startsWith(draft));
  if (col < 0) throw new Error(`No column ${draft}`);
  const tr = within(table).getByRole('rowheader', { name: row }).closest('tr');
  if (!tr) throw new Error(`No row ${row}`);
  // The first column is the row headings, with an empty cell over it.
  return tr.children[col + 1] as HTMLElement;
}

const verdict = () => screen.getByRole('region', { name: 'The editor’s verdict' });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ComparisonView side by side', () => {
  it('sets each draft’s scores side by side, marking the best on each appeal and how far behind the rest are', () => {
    renderView(aComparison());

    expect(cell('Credibility', 'Draft 2')).toHaveTextContent('72');
    expect(cell('Credibility', 'Draft 2')).toHaveTextContent('Best');
    expect(cell('Credibility', 'Subject A')).toHaveTextContent('60');
    expect(cell('Credibility', 'Subject A')).toHaveTextContent('12 behind');
    expect(cell('Credibility', 'Subject A')).not.toHaveTextContent('Best');

    // A tie: both lead.
    expect(cell('Logic', 'Subject A')).toHaveTextContent('Best');
    expect(cell('Logic', 'Draft 2')).toHaveTextContent('Best');
    expect(cell('Logic', 'Subject C')).toHaveTextContent('6 behind');

    // Overall: the best among the scored.
    expect(cell('Overall', 'Draft 2')).toHaveTextContent('74');
    expect(cell('Overall', 'Draft 2')).toHaveTextContent('Best');
    expect(cell('Overall', 'Draft 2')).toHaveTextContent('Lands well');
    expect(cell('Overall', 'Subject C')).toHaveTextContent('23 behind');
  });

  it('says a draft less than a point behind is under one behind, not 0', () => {
    const wire = aComparison();
    wire.appeals[0].drafts[0] = { position: 0, score: 71.7, delta: -0.3 };
    renderView(wire);
    expect(cell('Credibility', 'Subject A')).toHaveTextContent('<1 behind');
    expect(cell('Credibility', 'Subject A')).not.toHaveTextContent('0 behind');
  });

  it('names the appeals in the framework’s order, by their names', () => {
    renderView(aComparison());
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual([
      'Overall',
      'Credibility',
      'Emotion',
      'Logic',
      'Timing',
    ]);
  });

  it('links each draft to its own report', () => {
    renderView(aComparison());
    const links = screen.getAllByRole('link', { name: 'Open its report' });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/assessments/a-0',
      '/assessments/a-1',
      '/assessments/a-2',
    ]);
  });

  it('keeps a failed, a partial and a purged draft in their places, saying what each is', () => {
    const wire = aComparison({ status: 'partial' });
    wire.drafts[0] = { ...wire.drafts[0], status: 'partial' };
    wire.drafts[1] = {
      ...wire.drafts[1],
      status: 'failed',
      overall: null,
      band: null,
      appeals: null,
    };
    wire.drafts[2] = {
      ...wire.drafts[2],
      status: 'purged',
      assessmentId: null,
      overall: null,
      band: null,
      appeals: null,
    };
    wire.appeals = [];
    wire.verdict = { ...wire.verdict, status: 'skipped', draft: null, reason: 'too_few_completed' };
    renderView(wire);

    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveTextContent('Partly reviewed');
    expect(headers[0]).toHaveTextContent(/leaves it out of the verdict/);
    expect(headers[1]).toHaveTextContent('Failed');
    expect(headers[1]).toHaveTextContent(/failed, so it has no scores/);
    expect(headers[2]).toHaveTextContent('Deleted');
    expect(headers[2]).toHaveTextContent(/was deleted/);
    // A deleted review has no report to open.
    expect(within(headers[2]).queryByRole('link')).toBeNull();

    // The partial draft's own scores still show; the others' do not.
    expect(cell('Credibility', 'Subject A')).toHaveTextContent('60');
    expect(cell('Credibility', 'Draft 2')).toHaveTextContent('Not scored');
    expect(cell('Overall', 'Subject C')).toHaveTextContent('Not scored');
    expect(screen.getByText(/Fewer than two drafts were scored/)).toBeInTheDocument();
  });
});

describe('ComparisonView verdict', () => {
  it('names the draft that lands better, why, and the appeals that decide it', () => {
    renderView(aComparison());
    expect(verdict()).toHaveTextContent('Draft 2 lands better with this reader.');
    expect(verdict()).toHaveTextContent('It names the reader’s problem first');
    expect(within(verdict()).getByText('Timing')).toBeInTheDocument();
    expect(verdict()).toHaveTextContent('It says why now');
    expect(within(screen.getAllByRole('columnheader')[1]).getByText('Lands better')).toBeTruthy();
  });

  it.each([
    ['too_few_completed', /Fewer than two drafts were read by every one/],
    ['too_few_judges', /fewer than two AI reviewers/],
    ['predates_verdicts', /made before the editor gave verdicts/],
  ])('says why there is none when skipped for %s', (reason, text) => {
    renderView(
      aComparison({ verdict: { ...aComparison().verdict, status: 'skipped', draft: null, reason } })
    );
    expect(verdict()).toHaveTextContent(text);
    expect(screen.queryByText('Lands better')).toBeNull();
  });

  it('says the editor could not give one when it failed', () => {
    renderView(
      aComparison({
        verdict: { ...aComparison().verdict, status: 'failed', draft: null, reason: 'malformed' },
      })
    );
    expect(verdict()).toHaveTextContent(/could not give a verdict/);
  });

  it('waits for the drafts, then says the editor is reading, or will be asked again', () => {
    const { unmount } = renderView(aRunningComparison());
    expect(verdict()).toHaveTextContent(/once every draft has been reviewed/);
    unmount();

    const running = aComparison({
      verdict: { ...aComparison().verdict, status: 'running', draft: null },
    });
    const r = renderView(running);
    expect(verdict()).toHaveTextContent('The editor is reading the drafts.');
    r.unmount();

    renderView(
      aComparison({
        verdict: {
          ...aComparison().verdict,
          status: 'waiting',
          draft: null,
          reason: 'rate_limited',
        },
      })
    );
    expect(verdict()).toHaveTextContent(/will be asked again/);
  });
});

describe('ComparisonView while it runs', () => {
  it('shows the drafts still running, then reads the comparison again until it has ended', async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(aRunningComparison())
      .mockResolvedValueOnce(aComparison());
    renderView(aRunningComparison());

    expect(screen.getByText('1 of 3 drafts finished')).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader');
    expect(headers[1]).toHaveTextContent('Being reviewed');
    expect(within(headers[1]).getByRole('link', { name: 'Watch its review' })).toBeTruthy();
    expect(headers[2]).toHaveTextContent('Waiting to start');

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/comparisons/cmp-1');
    expect(screen.getByText('1 of 3 drafts finished')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(verdict()).toHaveTextContent('Draft 2 lands better');
    expect(screen.queryByText(/drafts finished/)).toBeNull();

    // Ended: it is not read again.
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('is never read again once it has ended', async () => {
    vi.useFakeTimers();
    renderView(aComparison());
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('says it may be behind after reads fail in a row, and keeps what it showed', async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient.get).mockRejectedValue(new Error('offline'));
    renderView(aRunningComparison());

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * (MAX_MISSES - 1)));
    expect(screen.queryByRole('status')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(screen.getByRole('status')).toHaveTextContent(/may be behind/);
    expect(screen.getByText('1 of 3 drafts finished')).toBeInTheDocument();

    // It keeps trying, and the notice goes once a read lands.
    vi.mocked(apiClient.get).mockResolvedValue(aRunningComparison());
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each([
    [404, /can no longer be found/],
    [401, /no longer signed in/],
  ])('stops reading after a %i, and says why', async (status, says) => {
    vi.useFakeTimers();
    vi.mocked(apiClient.get).mockRejectedValue(new APIClientError('No', 'X', status));
    renderView(aRunningComparison());

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(screen.getByRole('status')).toHaveTextContent(says);
    expect(screen.queryByText(/drafts finished/)).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 5));
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('says a draft still running is waiting, not unscored', () => {
    renderView(aRunningComparison());
    expect(cell('Overall', 'Draft 2')).toHaveTextContent('Waiting');
    expect(cell('Overall', 'Draft 2')).not.toHaveTextContent('Not scored');
  });

  it('stops saying the editor is reading once the page has stopped checking', async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient.get).mockRejectedValue(new APIClientError('No', 'X', 401));
    const wire = aComparison();
    renderView({
      ...wire,
      status: 'running',
      verdict: { ...wire.verdict, status: 'running', draft: null, why: null, appeals: [] },
    });
    expect(verdict()).toHaveTextContent('The editor is reading the drafts.');

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(verdict()).not.toHaveTextContent('is reading');
    expect(verdict()).toHaveTextContent('stopped checking');
  });

  it('counts a reply it cannot read as a failed read', async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient.get).mockResolvedValue({ nope: true });
    renderView(aRunningComparison());
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * MAX_MISSES));
    expect(screen.getByRole('status')).toHaveTextContent(/may be behind/);
  });

  it('does not read while the tab is in the background, and reads once it is shown', async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient.get).mockResolvedValue(aRunningComparison());
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    renderView(aRunningComparison());
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 2));
    expect(apiClient.get).not.toHaveBeenCalled();

    hidden.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    hidden.mockRestore();
  });
});
