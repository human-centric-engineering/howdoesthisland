// @vitest-environment happy-dom

/**
 * The report's rewrite drawer (t-82), with the editor stubbed at the network:
 * `fetch` answers the rewrites and assessments routes as the API would.
 *
 * @see components/app/report/rewrite-drawer.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { RewriteDrawer } from '@/components/app/report/rewrite-drawer';
import { rewriteFocuses } from '@/components/app/report/rewrite-focuses';
import type { RewriteWire } from '@/components/app/report/rewrite-client';

const focuses = rewriteFocuses([
  { id: 'ethos', name: 'Ethos', question: 'Do they trust it?' },
  { id: 'pathos', name: 'Pathos', question: 'Do they feel it?' },
]);

/** A fetch call's URL, whichever form it was given in. */
const urlOf = (u: RequestInfo | URL): string =>
  typeof u === 'string' ? u : u instanceof URL ? u.href : u.url;
/** A fetch call's JSON body. */
const bodyOf = (init?: RequestInit): unknown =>
  JSON.parse(typeof init?.body === 'string' ? init.body : 'null');

const row = (over: Partial<RewriteWire> = {}): RewriteWire => ({
  id: 'rw_new',
  assessmentId: 'asm_1',
  focus: 'ethos',
  status: 'running',
  draft: '',
  error: null,
  errorCode: null,
  model: 'm',
  costUsd: 0,
  createdAt: new Date().toISOString(),
  completedAt: null,
  ...over,
});

const earlierRow = row({
  id: 'rw_old',
  focus: 'pathos',
  status: 'completed',
  draft: 'An earlier draft.',
  createdAt: '2026-11-24T10:12:00.000Z',
});

const frame = (event: { type: string } & Record<string, unknown>): string =>
  `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

function streamed(frames: string[], end: 'close' | 'error' = 'close'): Response {
  const enc = new TextEncoder();
  const queue = [...frames];
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(c) {
        const next = queue.shift();
        if (next !== undefined) c.enqueue(enc.encode(next));
        else if (end === 'close') c.close();
        else c.error(new TypeError('network error'));
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } }
  );
}

const ok = (data: unknown): Response =>
  new Response(JSON.stringify({ success: true, data }), {
    headers: { 'Content-Type': 'application/json' },
  });
const refused = (status: number, code: string, message: string, details?: unknown): Response =>
  new Response(JSON.stringify({ success: false, error: { code, message, details } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** The routes, answered by the test: each a function of the request. */
let routes: {
  list: () => Response;
  post: () => Response;
  read: () => Response;
  assessment: () => Response;
  createReview: () => Response;
};
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = urlOf(input);
  const method = init?.method ?? 'GET';
  if (url.startsWith('/api/v1/rewrites?')) return routes.list();
  if (url === '/api/v1/rewrites' && method === 'POST') return routes.post();
  if (url.startsWith('/api/v1/rewrites/')) return routes.read();
  if (url === '/api/v1/assessments/asm_1') return routes.assessment();
  if (url === '/api/v1/assessments' && method === 'POST') return routes.createReview();
  throw new Error(`unexpected ${method} ${url}`);
});

const calls = (method: string, url: string) =>
  fetchMock.mock.calls.filter(
    ([u, init]) => urlOf(u) === url && (init?.method ?? 'GET') === method
  );

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  fetchMock.mockClear();
  push.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  routes = {
    list: () => ok([earlierRow]),
    post: () =>
      streamed([
        frame({ type: 'rewrite', rewrite: row() }),
        frame({ type: 'rewrite_text', text: 'A better ' }),
        frame({ type: 'rewrite_text', text: 'draft.' }),
        frame({
          type: 'rewrite_done',
          rewrite: row({ status: 'completed', draft: 'A better draft.' }),
        }),
      ]),
    read: () => ok(row({ status: 'completed', draft: 'A better draft.' })),
    assessment: () =>
      ok({
        id: 'asm_1',
        framework: { slug: 'howdoesthisland', version: '0.5.1' },
        context: { contentType: 'proposal' },
        projectId: 'prj_1',
        judges: ['judge_ethos', 'judge_logos'],
        status: 'completed',
      }),
    createReview: () => ok({ id: 'asm_2', status: 'queued' }),
  };
});
afterEach(() => vi.unstubAllGlobals());

/** Open the drawer, and wait for its earlier rewrites, `listed` among them. */
async function openDrawer(listed: RegExp = /Pathos · /) {
  render(<RewriteDrawer assessmentId="asm_1" focuses={focuses} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
  return screen.findByRole('button', { name: listed });
}

const draftBox = () => document.getElementById('rewrite-draft');

describe('RewriteDrawer', () => {
  it('offers balanced and each appeal, each with its help, balanced chosen', async () => {
    await openDrawer();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(['balanced', 'ethos', 'pathos']);
    expect(screen.getByRole('radio', { name: 'Balanced' })).toBeChecked();
    for (const name of ['Balanced', 'Ethos', 'Pathos']) {
      expect(screen.getByRole('button', { name: `About ${name}` })).toBeInTheDocument();
    }
  });

  it('streams a rewrite with the chosen focus into the drawer, then copies it', async () => {
    await openDrawer();
    fireEvent.click(screen.getByRole('radio', { name: 'Ethos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));

    await waitFor(() => expect(draftBox()?.textContent).toBe('A better draft.'));
    const [, init] = calls('POST', '/api/v1/rewrites')[0];
    expect(bodyOf(init)).toEqual({
      assessmentId: 'asm_1',
      focus: 'ethos',
      stream: true,
    });
    expect(screen.getByRole('heading', { name: 'Ethos rewrite' })).toBeInTheDocument();
    // It joins the earlier rewrites, newest first.
    const items = within(screen.getByRole('list')).getAllByRole('button');
    expect(items[0].textContent).toMatch(/^Ethos · .*Done$/);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByRole('button', { name: 'Copied' });
    expect(writeText).toHaveBeenCalledWith('A better draft.');
  });

  it('reopens an earlier rewrite from the list without starting one', async () => {
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: /Pathos · / }));
    expect(draftBox()?.textContent).toBe('An earlier draft.');
    expect(screen.getByRole('heading', { name: 'Pathos rewrite' })).toBeInTheDocument();
    expect(calls('POST', '/api/v1/rewrites')).toHaveLength(0);
  });

  it('follows an earlier rewrite still being written until it ends', async () => {
    routes.list = () => ok([row({ id: 'rw_run', draft: 'Half' })]);
    routes.read = () => ok(row({ id: 'rw_run', status: 'completed', draft: 'Half and whole.' }));
    fireEvent.click(await openDrawer(/Ethos · .*Writing/));
    await waitFor(() => expect(draftBox()?.textContent).toBe('Half and whole.'));
    expect(calls('GET', '/api/v1/rewrites/rw_run')).toHaveLength(1);
    expect(calls('POST', '/api/v1/rewrites')).toHaveLength(0);
  });

  it('reads the stored rewrite when its stream drops, and starts no second one', async () => {
    routes.post = () =>
      streamed(
        [
          frame({ type: 'rewrite', rewrite: row() }),
          frame({ type: 'rewrite_text', text: 'A bet' }),
        ],
        'error'
      );
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));

    await waitFor(() => expect(draftBox()?.textContent).toBe('A better draft.'));
    expect(calls('GET', '/api/v1/rewrites/rw_new')).toHaveLength(1);
    expect(calls('POST', '/api/v1/rewrites')).toHaveLength(1);
  });

  it('finds the rewrite a stream dropped before its first event had started', async () => {
    let listed = 0;
    routes.list = () => (listed++ === 0 ? ok([earlierRow]) : ok([row(), earlierRow]));
    routes.post = () => streamed([], 'error');
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));

    await waitFor(() => expect(draftBox()?.textContent).toBe('A better draft.'));
    expect(calls('GET', '/api/v1/rewrites/rw_new')).toHaveLength(1);
    expect(calls('POST', '/api/v1/rewrites')).toHaveLength(1);
  });

  it('says so when a stream dropped before anything started', async () => {
    routes.post = () => streamed([], 'error');
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));
    expect(
      await screen.findByText(
        'The connection dropped before the rewrite started. If it did start, it is listed below.'
      )
    ).toBeInTheDocument();
    expect(calls('POST', '/api/v1/rewrites')).toHaveLength(1);
  });

  it('shows a refusal beside the button in the assess page’s words, linking usage', async () => {
    routes.post = () =>
      refused(402, 'INSUFFICIENT_CREDITS', 'This needs 40 CopyCredits; the workspace has 12.', {
        usagePage: '/usage',
      });
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));
    expect(
      await screen.findByText('This needs 40 CopyCredits; the workspace has 12.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /usage/ })).toHaveAttribute('href', '/usage');
    expect(draftBox()).toBeNull();
  });

  it('words a rate limit as being about rewrites', async () => {
    routes.post = () => refused(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests');
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));
    expect(
      await screen.findByText(
        'You have started a lot of rewrites in the last minute. Wait a minute, then try again.'
      )
    ).toBeInTheDocument();
  });

  it('shows why a rewrite that started then failed stopped, keeping what it wrote', async () => {
    routes.post = () =>
      streamed([
        frame({ type: 'rewrite', rewrite: row() }),
        frame({
          type: 'rewrite_done',
          rewrite: row({ status: 'failed', draft: 'Part', error: 'The editor stopped.' }),
        }),
      ]);
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));
    expect(await screen.findByText('The editor stopped.')).toBeInTheDocument();
    expect(draftBox()?.textContent).toBe('Part');
    expect(screen.getByRole('button', { name: 'Review this draft' })).toBeDisabled();
  });

  it('reviews the draft with the original’s context, project and AI reviewers, and opens it', async () => {
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));
    const review = await screen.findByRole('button', { name: 'Review this draft' });
    await waitFor(() => expect(review).toBeEnabled());
    fireEvent.click(review);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/assessments/asm_2'));
    const [, init] = calls('POST', '/api/v1/assessments')[0];
    expect(bodyOf(init)).toEqual({
      source: { text: 'A better draft.' },
      framework: 'howdoesthisland',
      version: '0.5.1',
      context: { contentType: 'proposal' },
      projectId: 'prj_1',
      judges: ['judge_ethos', 'judge_logos'],
    });
  });

  it('shows a refused review of the draft beside its button', async () => {
    routes.createReview = () =>
      refused(402, 'BUDGET_EXCEEDED', 'The workspace is at its budget for the month.');
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));
    const review = await screen.findByRole('button', { name: 'Review this draft' });
    await waitFor(() => expect(review).toBeEnabled());
    fireEvent.click(review);
    expect(
      await screen.findByText('The workspace is at its budget for the month.')
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('stops reading when closed mid-draft, and lists the rewrite still writing on the next open', async () => {
    let listed = 0;
    routes.list = () =>
      listed++ === 0 ? ok([earlierRow]) : ok([row({ draft: 'A bet' }), earlierRow]);
    // A stream that never ends: the editor is still writing.
    routes.post = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode(frame({ type: 'rewrite', rewrite: row() })));
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));
    await screen.findByRole('heading', { name: 'Ethos rewrite · writing…' });

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));

    expect(await screen.findByRole('button', { name: /Ethos · .*Writing/ })).toBeInTheDocument();
    // Reopened clean, and nothing was started again.
    expect(draftBox()).toBeNull();
    expect(calls('POST', '/api/v1/rewrites')).toHaveLength(1);
  });

  it('says so when the earlier rewrites cannot be read', async () => {
    routes.list = () => refused(500, 'INTERNAL_ERROR', 'Something went wrong.');
    render(<RewriteDrawer assessmentId="asm_1" focuses={focuses} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('says the rewrite is still being written when following it fails', async () => {
    routes.list = () => ok([row({ id: 'rw_run', draft: 'Half' })]);
    routes.read = () => refused(500, 'INTERNAL_ERROR', 'Something went wrong.');
    fireEvent.click(await openDrawer(/Ethos · .*Writing/));
    expect(
      await screen.findByText(
        'The rewrite could not be read. It is still being written: open this again in a moment to see it.'
      )
    ).toBeInTheDocument();
    expect(draftBox()?.textContent).toBe('Half');
  });

  it('shows the server’s own words for a refusal it does not word itself', async () => {
    routes.post = () =>
      refused(
        409,
        'ASSESSMENT_NOT_REWRITABLE',
        'This review’s model version can no longer be run.'
      );
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));
    expect(
      await screen.findByText(/This review’s model version can no longer be run\./)
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /usage/ })).toBeNull();
  });

  it('selects the draft to copy by hand when there is no clipboard', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: /Pathos · / }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(window.getSelection()?.toString()).toBe('An earlier draft.'));
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
  });

  it('shows the server’s words for a review of the draft refused for another reason', async () => {
    routes.createReview = () =>
      refused(400, 'CONTEXT_INVALID', 'The context does not fit this framework version.');
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: /Pathos · / }));
    fireEvent.click(screen.getByRole('button', { name: 'Review this draft' }));
    expect(
      await screen.findByText(/The context does not fit this framework version\./)
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Review this draft' })).toBeEnabled();
  });
});
