// @vitest-environment happy-dom

/**
 * The `/assess` workbench (t-78).
 *
 * Mocked: the API client, the router, the Radix select (a native one in its
 * place; `select-mock.tsx`) and the browser's `EventSource`. What is proved:
 * a project's defaults fill the settings and the reviewers, which can still
 * be changed; every non-trivial field has its help; the request is the one
 * the API takes, for text, a page and a file; a review that runs shows its
 * quick scan at once, then the live progress, and the report once it is
 * final; each refusal shows by Start, in words to act on; the draft is kept
 * in the browser and restored.
 *
 * @see components/app/workbench/assess-workbench.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { patch: vi.fn(), post: vi.fn(), get: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/components/ui/select', async () => {
  const { selectMock } = await import('@/tests/unit/components/app/projects/select-mock');
  return selectMock;
});

import { AssessWorkbench } from '@/components/app/workbench/assess-workbench';
import { DRAFT_KEY, EMPTY_DRAFT } from '@/components/app/workbench/assess-draft';
import { apiClient, APIClientError } from '@/lib/api/client';
import { MAX_REVIEW_FILE_BYTES } from '@/lib/app/assessments/limits';
import { aProject } from '@/tests/unit/components/app/projects/fixtures';
import { FakeEventSource } from '@/tests/unit/components/app/workbench/fake-event-source';
import { QUICK_RESULT, anAssessCatalogue } from '@/tests/unit/components/app/workbench/fixtures';

const PROJECT = aProject({
  id: 'proj-1',
  name: 'Spring launch',
  defaults: {
    context: {
      contentType: 'landing_page',
      archetype: 'sceptic',
      audience: { relationship: 'warm' },
    },
    profile: 'craft',
  },
});
const BARE = aProject({ id: 'proj-2', name: 'Bare', defaults: {} });

function field<T extends HTMLElement = HTMLElement>(label: RegExp): T {
  return screen.getByLabelText<T>(label, { selector: 'input, textarea, select' });
}

function renderWorkbench(projects = [PROJECT, BARE]) {
  return render(<AssessWorkbench catalogue={anAssessCatalogue()} projects={projects} />);
}

/** The body of the last POST. */
function sentBody(): Record<string, unknown> {
  const call = vi.mocked(apiClient.post).mock.calls.at(-1);
  if (!call) throw new Error('Nothing was posted');
  const options = call[1] as { body: Record<string, unknown> };
  return options.body;
}

const start = () => userEvent.click(screen.getByRole('button', { name: 'Start the review' }));

const created = (overrides: Record<string, unknown> = {}) => ({
  id: 'a-9',
  stored: true,
  status: 'queued',
  profile: 'full',
  judges: ['judge_ethos', 'judge_craft'],
  quickScan: { overall: 52, band: 'Mixed', result: QUICK_RESULT },
  judgeRuns: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AssessWorkbench settings', () => {
  it('starts on the model’s defaults, with no project', () => {
    renderWorkbench();
    expect(field(/^Project/)).toHaveValue('__none__');
    expect(field(/^Type of copy/)).toHaveValue('__none__');
    expect(field(/^AI reviewers/)).toHaveValue('full');
  });

  it('fills the settings and the reviewers from a project’s defaults', async () => {
    renderWorkbench();
    await userEvent.selectOptions(field(/^Project/), 'proj-1');

    expect(field(/^Type of copy/)).toHaveValue('landing_page');
    expect(field(/^Reader(?!’)/)).toHaveValue('sceptic');
    expect(field(/^Relationship with the reader/)).toHaveValue('warm');
    expect(field(/^AI reviewers/)).toHaveValue('craft');
    // Left out, the API would fill it from the project again: no model's default to pick.
    expect(
      within(field(/^Type of copy/)).queryByRole('option', { name: 'The model’s default' })
    ).not.toBeInTheDocument();
    // A setting the project leaves open still offers it.
    expect(
      within(field(/^Reader’s role/)).getByRole('option', { name: 'The model’s default' })
    ).toBeInTheDocument();
  });

  it('lets a project’s default be changed, and sends what is chosen', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(created({ status: 'completed', judges: [] }));
    renderWorkbench();
    await userEvent.selectOptions(field(/^Project/), 'proj-1');
    await userEvent.selectOptions(field(/^Type of copy/), 'general');
    await userEvent.selectOptions(field(/^AI reviewers/), 'quick');
    await userEvent.type(field(/^The copy to review/), 'Book a call today.');
    await start();

    expect(sentBody()).toEqual({
      source: { text: 'Book a call today.' },
      context: { contentType: 'general', archetype: 'sceptic', audience: { relationship: 'warm' } },
      projectId: 'proj-1',
      profile: 'quick',
    });
  });

  it('clears the settings back to the model’s when the project is taken off', async () => {
    renderWorkbench();
    await userEvent.selectOptions(field(/^Project/), 'proj-1');
    await userEvent.selectOptions(field(/^Project/), '__none__');

    expect(field(/^Type of copy/)).toHaveValue('__none__');
    expect(field(/^AI reviewers/)).toHaveValue('full');
  });

  it('offers no project picker to a workspace with none', () => {
    renderWorkbench([]);
    expect(screen.queryByLabelText(/^Project/, { selector: 'select' })).not.toBeInTheDocument();
  });

  it('gives every non-trivial field its help, in its label', async () => {
    renderWorkbench();
    const helpIn = (id: string) =>
      document
        .querySelector(`label[for="${id}"]`)
        ?.querySelector('button[aria-label="More information"]');

    // Project, type of copy, reader, role, one audience setting, AI reviewers.
    const pickers = screen.getAllByRole('combobox');
    expect(pickers).toHaveLength(6);
    for (const picker of pickers) expect(helpIn(picker.id)).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: 'File' }));
    expect(helpIn('assess-file')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'Web page' }));
    expect(helpIn('assess-url')).toBeTruthy();
  });

  it('sends the AI reviewers ticked one by one, in the version’s order, and leaves out culture with the switch off', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(created());
    renderWorkbench();
    await userEvent.selectOptions(field(/^AI reviewers/), '__choose__');

    const ticks = within(screen.getByRole('group', { name: /Tick the AI reviewers/ }));
    expect(ticks.getAllByRole('checkbox').map((c) => c.parentElement?.textContent)).toEqual([
      'Ethos',
      'Pathos',
      'Craft',
    ]);
    await userEvent.click(ticks.getByRole('checkbox', { name: 'Craft' }));
    await userEvent.click(ticks.getByRole('checkbox', { name: 'Ethos' }));
    await userEvent.type(field(/^The copy to review/), 'Copy');
    await start();

    expect(sentBody()).toEqual({
      source: { text: 'Copy' },
      judges: ['judge_ethos', 'judge_craft'],
    });
  });
});

describe('AssessWorkbench sources', () => {
  it('sends a page by its address', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(created());
    renderWorkbench();
    await userEvent.click(screen.getByRole('tab', { name: 'Web page' }));
    await userEvent.type(field(/^The page’s address/), ' https://example.com/pricing ');
    await start();

    expect(sentBody()).toEqual({ source: { url: 'https://example.com/pricing' }, profile: 'full' });
  });

  it('sends a file as base64, by its name', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(created());
    renderWorkbench();
    await userEvent.click(screen.getByRole('tab', { name: 'File' }));
    await userEvent.upload(
      field(/^A file to review/),
      new File(['Hello'], 'brief.txt', { type: 'text/plain' })
    );
    await start();

    expect(sentBody()).toEqual({
      source: { file: { name: 'brief.txt', base64: btoa('Hello') } },
      profile: 'full',
    });
  });

  it('keeps the chosen file in its input across a change of tab, as the one Start sends', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(created());
    renderWorkbench();
    await userEvent.click(screen.getByRole('tab', { name: 'File' }));
    await userEvent.upload(
      field(/^A file to review/),
      new File(['Hello'], 'brief.txt', { type: 'text/plain' })
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Text' }));
    await userEvent.click(screen.getByRole('tab', { name: 'File' }));

    expect(field<HTMLInputElement>(/^A file to review/).files?.[0]?.name).toBe('brief.txt');
    await start();
    expect(sentBody()).toMatchObject({ source: { file: { name: 'brief.txt' } } });
  });

  it('refuses a file over the limit before sending it', async () => {
    renderWorkbench();
    await userEvent.click(screen.getByRole('tab', { name: 'File' }));
    const big = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: MAX_REVIEW_FILE_BYTES + 1 });
    await userEvent.upload(field(/^A file to review/), big);
    await start();

    expect(apiClient.post).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/huge\.pdf is 10\.0 MB/);
  });

  it('asks for copy, or an address, before sending', async () => {
    renderWorkbench();
    await start();
    expect(screen.getByRole('alert')).toHaveTextContent('Paste some copy to review.');

    await userEvent.click(screen.getByRole('tab', { name: 'Web page' }));
    await userEvent.type(field(/^The page’s address/), 'example.com');
    await start();
    expect(screen.getByRole('alert')).toHaveTextContent(/full address, starting https/);
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('AssessWorkbench once started', () => {
  it('shows the quick scan at once, then each AI reviewer as it lands, then opens the report', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(created());
    renderWorkbench();
    await userEvent.type(field(/^The copy to review/), 'Copy');
    await start();

    const scan = await screen.findByTestId('review-quick-scan');
    expect(within(scan).getByText('52')).toBeInTheDocument();
    const stream = FakeEventSource.latest();
    expect(stream.url).toBe('/api/v1/assessments/a-9/events');

    act(() =>
      stream.emit({
        type: 'assessment_judge',
        id: 'a-9',
        judge: 'judge_craft',
        status: 'succeeded',
        model: 'm',
        costUsd: 0,
        latencyMs: 1,
        errorCode: null,
      })
    );
    expect(screen.getByText(/1 of 2 AI reviewers have finished/)).toBeInTheDocument();

    act(() =>
      stream.emit({
        type: 'assessment_done',
        id: 'a-9',
        status: 'completed',
        overall: 60,
        band: 'Good',
        costUsd: 0.1,
        error: null,
        errorCode: null,
      })
    );
    expect(push).toHaveBeenCalledWith('/assessments/a-9');
  });

  it('opens the report straight away for a review final at once (the quick scan only)', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(
      created({ status: 'completed', judges: [], quickScan: null })
    );
    renderWorkbench();
    await userEvent.type(field(/^The copy to review/), 'Copy');
    await start();

    await waitFor(() => expect(push).toHaveBeenCalledWith('/assessments/a-9'));
    expect(FakeEventSource.opened).toHaveLength(0);
  });
});

describe('AssessWorkbench with a reply it cannot read', () => {
  it('opens the report of a review started with a reply it cannot read in full, and keeps no draft to start again', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(created({ status: 'paused_for_lunch' }));
    renderWorkbench();
    await userEvent.type(field(/^The copy to review/), 'Copy');
    await start();

    await waitFor(() => expect(push).toHaveBeenCalledWith('/assessments/a-9'));
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(screen.queryByText(/could not be started/)).toBeNull();
  });

  it('says a review with no readable id has started, rather than that it failed', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ stored: true });
    renderWorkbench();
    await userEvent.type(field(/^The copy to review/), 'Copy');
    await start();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /has started.*no need to start it again/
    );
    expect(push).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe('AssessWorkbench refusals', () => {
  async function refusedWith(err: APIClientError) {
    vi.mocked(apiClient.post).mockRejectedValue(err);
    renderWorkbench();
    await userEvent.type(field(/^The copy to review/), 'Copy');
    await start();
    return screen.findByRole('alert');
  }

  it.each([
    ['INSUFFICIENT_CREDITS', 'You have no CopyCredits left. Buy more on /usage.'],
    ['BUDGET_EXCEEDED', 'The workspace has used its $5.00 monthly AI budget. See /usage.'],
  ])('%s: the server’s reason by Start, and a link to the usage page', async (code, message) => {
    const alert = await refusedWith(
      new APIClientError(message, code, 402, { usagePage: '/usage', estimateCredits: 3 })
    );

    expect(alert).toHaveTextContent(message);
    // Beside the action: in the same column as Start.
    expect(alert.closest('div.hd-sheet')).toContainElement(
      screen.getByRole('button', { name: 'Start the review' })
    );
    expect(screen.getByRole('link', { name: 'See this month’s usage' })).toHaveAttribute(
      'href',
      '/usage'
    );
  });

  it('a busy workspace: to try again when a review has finished', async () => {
    const alert = await refusedWith(
      new APIClientError('Busy', 'WORKSPACE_BUSY', 429, { limit: 3, running: 3 })
    );
    expect(alert).toHaveTextContent(/as many reviews running as it can/);
    expect(screen.queryByRole('link', { name: /usage/ })).not.toBeInTheDocument();
  });

  it('too many reviews this minute: to wait a minute', async () => {
    const alert = await refusedWith(
      new APIClientError('Too many requests', 'RATE_LIMIT_EXCEEDED', 429)
    );
    expect(alert).toHaveTextContent(/Wait a minute, then try again/);
  });

  it.each([
    ['FETCH_FAILED', 422, 'That page could not be fetched: it answered 404.'],
    ['TEXT_TOO_LONG', 422, 'That is over 40,000 characters.'],
    ['FILE_TOO_LARGE', 413, 'This file is 12.0 MB; the largest we read is 10 MB.'],
  ])('%s: the intake’s own words', async (code, status, message) => {
    const alert = await refusedWith(new APIClientError(message, code, status));
    expect(alert).toHaveTextContent(message);
  });

  it('keeps the draft when a review is refused', async () => {
    await refusedWith(new APIClientError('Busy', 'WORKSPACE_BUSY', 429));
    expect(field(/^The copy to review/)).toHaveValue('Copy');
  });
});

describe('AssessWorkbench draft', () => {
  it('restores the text, the project and the settings after a reload, and not a file', async () => {
    const first = renderWorkbench();
    await userEvent.selectOptions(field(/^Project/), 'proj-1');
    await userEvent.selectOptions(field(/^Reader’s role/), 'cfo');
    await userEvent.type(field(/^The copy to review/), 'Half-written copy');
    first.unmount();

    renderWorkbench();
    await waitFor(() => expect(field(/^The copy to review/)).toHaveValue('Half-written copy'));
    expect(field(/^Project/)).toHaveValue('proj-1');
    expect(field(/^Reader’s role/)).toHaveValue('cfo');
    expect(field(/^Type of copy/)).toHaveValue('landing_page');
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toMatch(/base64/);
  });

  it('starts afresh from a stored draft it cannot read', async () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ source: 'fax', text: 7 }));
    renderWorkbench();
    await waitFor(() => expect(field(/^The copy to review/)).toHaveValue(EMPTY_DRAFT.text));
    expect(field(/^AI reviewers/)).toHaveValue('full');
  });

  it('drops a project that is no longer offered', async () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ ...EMPTY_DRAFT, projectId: 'proj-archived', text: 'Kept' })
    );
    renderWorkbench();
    await waitFor(() => expect(field(/^The copy to review/)).toHaveValue('Kept'));
    expect(field(/^Project/)).toHaveValue('__none__');
  });

  it('clears the draft once the review has started', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(created());
    renderWorkbench();
    await userEvent.type(field(/^The copy to review/), 'Copy');
    await start();
    await screen.findByTestId('review-quick-scan');

    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
