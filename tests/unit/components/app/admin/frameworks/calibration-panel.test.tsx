// @vitest-environment happy-dom

/**
 * The versions and their calibration runs (t-38): the run table, starting a
 * run, polling while one runs, and a refused start shown beside the buttons.
 * Only `apiClient` is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

import { CalibrationPanel } from '@/components/app/admin/frameworks/calibration-panel';
import { apiClient, APIClientError } from '@/lib/api/client';
import type { FrameworkCalibrationWire } from '@/lib/app/calibration/wire';
import { comparison, run, version } from '@/tests/unit/components/app/admin/frameworks/fixtures';

const framework = (versions = [version()]): FrameworkCalibrationWire => ({
  slug: 'howdoesthisland',
  name: 'HowDoesThisLand',
  versions,
});

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('CalibrationPanel', () => {
  it('shows each run’s agreement by kind with its change, cost and starter', () => {
    const ai = run({
      id: 'run-ai',
      mode: 'ai',
      costUsd: 1.234,
      comparison,
      startedBy: null,
      ofCurrentFile: false,
    });
    render(<CalibrationPanel initial={framework([version({ runs: [ai] })])} />);
    const row = screen.getByRole('button', { name: /Show this ai run's cases/ }).closest('tr');
    const text = row?.textContent ?? '';
    expect(text).toContain('70.0%');
    expect(text).toContain('+5.0 pts');
    // Appeals 6 of 10, down 10 points; flags unchanged; duties up.
    expect(text).toContain('60.0%6/10-10.0 pts');
    expect(text).toContain('±0 pts');
    expect(text).toContain('+50.0 pts');
    expect(text).toContain('$1.23');
    expect(text).toContain('CLI');
    expect(text).toContain('of an earlier import');
  });

  it('shows a dash for a running run’s results and cost, and a failed judge count', () => {
    const running = run({ id: 'r', mode: 'ai', status: 'running', totals: null, rows: null });
    const partial = run({ id: 'p', mode: 'ai', costUsd: 2 });
    if (partial.totals) partial.totals.judgeFailures = 3;
    render(<CalibrationPanel initial={framework([version({ runs: [running, partial] })])} />);
    const [, runningRow, partialRow] = screen.getAllByRole('row');
    expect(within(runningRow).getAllByText('–').length).toBeGreaterThanOrEqual(6);
    expect(runningRow.textContent).not.toContain('$');
    expect(partialRow.textContent).toContain('3 judge call(s) failed');
    // An AI run is running, so another cannot be started.
    expect(screen.getByRole('button', { name: 'AI run running' })).toBeDisabled();
  });

  it('shows a failed AI run’s cost, and a dash for a stopped one’s, which was never recorded', () => {
    const failed = run({
      id: 'f',
      mode: 'ai',
      status: 'failed',
      totals: null,
      rows: null,
      costUsd: 0.5,
    });
    const stopped = run({
      id: 's',
      mode: 'ai',
      status: 'stopped',
      totals: null,
      rows: null,
      costUsd: 0,
    });
    render(<CalibrationPanel initial={framework([version({ runs: [failed, stopped] })])} />);
    const [, failedRow, stoppedRow] = screen.getAllByRole('row');
    expect(failedRow.textContent).toContain('$0.50');
    expect(stoppedRow.textContent).not.toContain('$');
  });

  it('describes each version’s calibration', () => {
    render(
      <CalibrationPanel
        initial={framework([
          version({
            id: 'a',
            version: '0.6.0',
            calibration: {
              runId: 'abcdef123456',
              ranAt: '2026-11-16T00:00:00.000Z',
              agreement: 0.8123,
              setVersion: '0.6.0',
              checks: 300,
              judgeModels: {},
            },
          }),
          version({ id: 'b', version: '0.7.0', status: 'draft', runnable: false }),
          version({ id: 'c' }),
        ])}
      />
    );
    expect(screen.getByText(/81\.2% agreement over 300 checks/)).toBeInTheDocument();
    expect(screen.getByText(/abcdef12/)).toBeInTheDocument();
    expect(screen.getByText(/A draft: it publishes once/)).toBeInTheDocument();
    expect(screen.getByText(/No calibration set is written for this version/)).toBeInTheDocument();
    expect(screen.getByText(/Published before the calibration gate/)).toBeInTheDocument();
    expect(screen.getAllByText('No runs yet.')).toHaveLength(3);
  });

  it('says so when no version is imported', () => {
    render(<CalibrationPanel initial={framework([])} />);
    expect(screen.getByText(/No version of HowDoesThisLand has been imported/)).toBeInTheDocument();
  });

  it('starts a quick run, reloads the list and opens the new run', async () => {
    const started = run({ id: 'new-run' });
    vi.mocked(apiClient.post).mockResolvedValue({ runId: 'new-run', status: 'complete' });
    vi.mocked(apiClient.get).mockResolvedValue([framework([version({ runs: [started] })])]);
    render(<CalibrationPanel initial={framework()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Quick run' }));

    await waitFor(() => expect(screen.getByText('Cases')).toBeInTheDocument());
    expect(apiClient.post).toHaveBeenCalledWith(
      // The slug the list gave, not one written into the panel.
      '/api/v1/admin/frameworks/howdoesthisland/versions/0.5.1/calibration-runs',
      { body: { mode: 'quick' } }
    );
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/admin/frameworks');
  });

  it('shows a refused start beside the buttons', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('An AI run of 0.5.1 is still running.', 'CALIBRATION_RUNNING', 409)
    );
    render(<CalibrationPanel initial={framework()} />);
    fireEvent.click(screen.getByRole('button', { name: 'AI run' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('is still running');
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('opens a run picked from the table, by its row or its date', () => {
    render(<CalibrationPanel initial={framework([version({ runs: [run()] })])} />);
    expect(screen.queryByText('Cases')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show this quick run's cases/ }));
    expect(screen.getByText('Cases')).toBeInTheDocument();
  });

  it('reads the list again while a run is running, and stops once none is', async () => {
    vi.useFakeTimers();
    const running = run({ status: 'running', totals: null, rows: null, mode: 'ai' });
    vi.mocked(apiClient.get).mockResolvedValue([framework([version({ runs: [run()] })])]);
    render(<CalibrationPanel initial={framework([version({ runs: [running] })])} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(screen.getByText('complete')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });
});
