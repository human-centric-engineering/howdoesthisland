// @vitest-environment happy-dom

/**
 * Starting a comparison from the `/assess` workbench (t-89).
 *
 * Mocked: the API client, the router and the Radix select (a native one in
 * its place; `select-mock.tsx`). What is proved: the Compare tab holds 2–5
 * drafts, each with its help; the request is the one
 * `POST /api/v1/comparisons` takes, with the reader settings and reviewers
 * given once; a started comparison opens its page and spends the draft; an
 * empty, too long or over-named draft is refused before anything is sent; a
 * refusal shows by Start; the drafts are kept in the browser, and a draft
 * kept before comparing existed still reads.
 *
 * @see components/app/workbench/assess-workbench.tsx
 * @see components/app/workbench/assess-draft.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { patch: vi.fn(), post: vi.fn(), get: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/app/intake/send-upload', () => ({ sendUpload: vi.fn() }));
vi.mock('@/components/ui/select', async () => {
  const { selectMock } = await import('@/tests/unit/components/app/projects/select-mock');
  return selectMock;
});

import { AssessWorkbench } from '@/components/app/workbench/assess-workbench';
import { DRAFT_KEY, EMPTY_DRAFT, readDraft } from '@/components/app/workbench/assess-draft';
import { apiClient, APIClientError } from '@/lib/api/client';
import { MAX_CONTENT_CHARS } from '@/lib/app/assessments/limits';
import { aProject } from '@/tests/unit/components/app/projects/fixtures';
import { anAssessCatalogue } from '@/tests/unit/components/app/workbench/fixtures';

const VERSION = '0.5.2';
const PROJECT = aProject({
  id: 'proj-1',
  name: 'Spring launch',
  defaults: { context: { contentType: 'landing_page' }, profile: 'craft' },
});

function renderWorkbench() {
  return render(
    <AssessWorkbench catalogue={anAssessCatalogue()} version={VERSION} projects={[PROJECT]} />
  );
}

function field<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`No field #${id}`);
  return el as T;
}

async function openCompare() {
  await userEvent.click(screen.getByRole('tab', { name: 'Compare drafts' }));
}

async function writeDraft(i: number, text: string, label?: string) {
  if (label !== undefined) await userEvent.type(field(`compare-label-${i}`), label);
  await userEvent.type(field(`compare-text-${i}`), text);
}

const compareButton = (n: number) =>
  screen.getByRole('button', { name: `Compare the ${n} drafts` });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('Compare drafts tab', () => {
  it('starts with two drafts, adds up to five and removes down to two', async () => {
    renderWorkbench();
    await openCompare();
    expect(screen.getAllByRole('group', { name: /^Draft \d$/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /^Remove draft/ })).toBeNull();

    const add = () => userEvent.click(screen.getByRole('button', { name: 'Add a draft' }));
    await add();
    await add();
    await add();
    expect(screen.getAllByRole('group', { name: /^Draft \d$/ })).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'Add a draft' })).toBeNull();
    expect(compareButton(5)).toBeInTheDocument();

    await userEvent.type(field('compare-text-2'), 'Third');
    await userEvent.click(screen.getByRole('button', { name: 'Remove draft 2' }));
    // The rest close up: the third draft is now the second.
    expect(field('compare-text-1')).toHaveValue('Third');
    expect(screen.getAllByRole('group', { name: /^Draft \d$/ })).toHaveLength(4);
  });

  it('gives each draft’s name and copy their help, in the label', async () => {
    renderWorkbench();
    await openCompare();
    for (const id of ['compare-label-0', 'compare-text-0', 'compare-label-1', 'compare-text-1']) {
      expect(
        document
          .querySelector(`label[for="${id}"]`)
          ?.querySelector('button[aria-label="More information"]')
      ).toBeTruthy();
    }
  });

  it('sends the drafts with the reader and reviewers given once, then opens the comparison', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ id: 'cmp-1', status: 'running' });
    renderWorkbench();
    await userEvent.selectOptions(field('assess-project'), 'proj-1');
    await openCompare();
    await writeDraft(0, 'Your books, done by Friday.', '  Subject A  ');
    await writeDraft(1, 'Bookkeeping services available.');
    await userEvent.click(compareButton(2));

    expect(apiClient.post).toHaveBeenCalledTimes(1);
    const [endpoint, options] = vi.mocked(apiClient.post).mock.calls[0];
    expect(endpoint).toBe('/api/v1/comparisons');
    expect((options as { body: unknown }).body).toEqual({
      drafts: [
        // A name is trimmed; a draft with none is sent without one.
        { text: 'Your books, done by Friday.', label: 'Subject A' },
        { text: 'Bookkeeping services available.' },
      ],
      framework: 'howdoesthisland',
      version: VERSION,
      context: { contentType: 'landing_page' },
      projectId: 'proj-1',
      profile: 'craft',
    });
    expect(push).toHaveBeenCalledWith('/compare/cmp-1');
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('says a comparison with no readable id has started, rather than that it failed', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ nope: true });
    renderWorkbench();
    await openCompare();
    await writeDraft(0, 'A');
    await writeDraft(1, 'B');
    await userEvent.click(compareButton(2));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /The comparison has started.*no need to start it again/
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('refuses an empty draft, or one too long, before sending, naming it', async () => {
    renderWorkbench();
    await openCompare();
    await writeDraft(0, 'Only the first', 'Subject A');
    await userEvent.click(compareButton(2));
    expect(screen.getByRole('alert')).toHaveTextContent('Paste the copy for Draft 2.');

    // Pasted, not typed: typing this many characters one by one is slow.
    await userEvent.click(field('compare-text-1'));
    await userEvent.paste('x'.repeat(MAX_CONTENT_CHARS + 1));
    await userEvent.click(compareButton(2));
    expect(screen.getByRole('alert')).toHaveTextContent(/Draft 2 is over .* characters/);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('refuses a name over the limit before sending', async () => {
    renderWorkbench();
    await openCompare();
    await userEvent.click(field('compare-label-0'));
    await userEvent.paste('n'.repeat(81));
    await writeDraft(0, 'A');
    await writeDraft(1, 'B');
    await userEvent.click(compareButton(2));
    expect(screen.getByRole('alert')).toHaveTextContent(/to 80 characters/);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('shows a refusal by Start and keeps the drafts', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('Too many', 'RATE_LIMIT_EXCEEDED', 429)
    );
    renderWorkbench();
    await openCompare();
    await writeDraft(0, 'A');
    await writeDraft(1, 'B');
    await userEvent.click(compareButton(2));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Wait a minute/);
    expect(readDraft(JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? 'null')).drafts).toEqual([
      { label: '', text: 'A' },
      { label: '', text: 'B' },
    ]);
  });

  it('says the quick scan alone gives no verdict', async () => {
    renderWorkbench();
    await openCompare();
    expect(screen.queryByText(/editor gives no verdict/)).toBeNull();
    await userEvent.selectOptions(field('assess-profile'), 'quick');
    expect(screen.getByRole('note')).toHaveTextContent(/editor gives no verdict/);
  });

  it('says one reviewer ticked gives no verdict, and two do', async () => {
    renderWorkbench();
    await openCompare();
    await userEvent.selectOptions(field('assess-profile'), '__choose__');
    const boxes = screen.getAllByRole('checkbox');
    await userEvent.click(boxes[0]);
    expect(screen.getByRole('note')).toHaveTextContent(/fewer than 2 .*editor gives no verdict/i);
    await userEvent.click(boxes[1]);
    expect(screen.queryByText(/editor gives no verdict/)).toBeNull();
  });

  it('names the draft the server refused, and moves focus to it', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('This copy has no words to review.', 'VALIDATION_ERROR', 400, {
        position: 1,
      })
    );
    renderWorkbench();
    await openCompare();
    await writeDraft(0, 'A');
    await writeDraft(1, 'B', 'Subject B');
    await userEvent.click(compareButton(2));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Subject B: This copy has no words to review.'
    );
    expect(field('compare-text-1')).toHaveFocus();
  });

  it('names the comparison, not a review, when starting it fails without a reason', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('network down'));
    renderWorkbench();
    await openCompare();
    await writeDraft(0, 'A');
    await writeDraft(1, 'B');
    await userEvent.click(compareButton(2));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The comparison could not be started. Try again in a moment.'
    );
  });
});

describe('Compare drafts kept in the browser', () => {
  it('restores the drafts after a reload', async () => {
    const first = renderWorkbench();
    await openCompare();
    await writeDraft(0, 'Kept copy', 'Kept name');
    first.unmount();

    renderWorkbench();
    await waitFor(() => expect(field('compare-text-0')).toHaveValue('Kept copy'));
    expect(field('compare-label-0')).toHaveValue('Kept name');
  });

  it('reads a draft kept before comparing existed, keeping its text', () => {
    const { drafts: _drafts, ...before } = EMPTY_DRAFT;
    const read = readDraft({ ...before, text: 'Older draft' });
    expect(read.text).toBe('Older draft');
    expect(read.drafts).toEqual([
      { label: '', text: '' },
      { label: '', text: '' },
    ]);
  });

  it('keeps the other drafts when one stored draft is out of shape', () => {
    const read = readDraft({
      ...EMPTY_DRAFT,
      drafts: [{ label: 'One', text: 'x' }, { label: 7 }],
    });
    expect(read.drafts).toEqual([
      { label: 'One', text: 'x' },
      { label: '', text: '' },
    ]);
  });

  it('starts the drafts again, not the rest, when they are stored out of shape', () => {
    const read = readDraft({ ...EMPTY_DRAFT, text: 'Kept', drafts: [{ label: 'One', text: 'x' }] });
    expect(read.text).toBe('Kept');
    expect(read.drafts).toHaveLength(2);
    expect(read.drafts.every((d) => d.text === '')).toBe(true);
  });
});
