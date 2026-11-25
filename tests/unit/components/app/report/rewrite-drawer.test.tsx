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
  placeholders: [],
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
  list: () => Response | Promise<Response>;
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
        title: 'Q3 board briefing',
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
    fireEvent.click(screen.getByRole('radio', { name: 'Ethos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));

    await waitFor(() => expect(draftBox()?.textContent).toBe('A better draft.'));
    expect(calls('GET', '/api/v1/rewrites/rw_new')).toHaveLength(1);
    expect(calls('POST', '/api/v1/rewrites')).toHaveLength(1);
  });

  it('does not take another focus’s rewrite, started in that window, for the one asked for', async () => {
    let listed = 0;
    routes.list = () =>
      listed++ === 0
        ? ok([earlierRow])
        : ok([row({ id: 'rw_theirs', focus: 'pathos' }), earlierRow]);
    routes.post = () => streamed([], 'error');
    await openDrawer();
    fireEvent.click(screen.getByRole('radio', { name: 'Ethos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));

    expect(
      await screen.findByText(
        'The connection dropped before the rewrite started. If it did start, it is listed below.'
      )
    ).toBeInTheDocument();
    expect(calls('GET', '/api/v1/rewrites/rw_theirs')).toHaveLength(0);
  });

  it('keeps the text that streamed when its stream drops and the stored draft is behind', async () => {
    routes.post = () =>
      streamed(
        [
          frame({ type: 'rewrite', rewrite: row() }),
          frame({ type: 'rewrite_text', text: 'A better draft, so far' }),
        ],
        'error'
      );
    // Saved every few seconds, the stored draft is shorter than what streamed.
    routes.read = () => ok(row({ draft: 'A bet' }));
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));

    await waitFor(() => expect(calls('GET', '/api/v1/rewrites/rw_new')).toHaveLength(1));
    expect(draftBox()?.textContent).toBe('A better draft, so far');
    expect(calls('POST', '/api/v1/rewrites')).toHaveLength(1);
  });

  it('keeps a rewrite started while an older read of the list was still on its way', async () => {
    // The read made on opening lands last, after the rewrite has started.
    let answerFirst: (r: Response) => void = () => undefined;
    let listed = 0;
    routes.list = () =>
      listed++ === 0
        ? new Promise<Response>((resolve) => (answerFirst = resolve))
        : ok([earlierRow]);
    render(<RewriteDrawer assessmentId="asm_1" focuses={focuses} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));
    await waitFor(() => expect(draftBox()?.textContent).toBe('A better draft.'));

    answerFirst(ok([]));
    await waitFor(() => expect(listed).toBe(2));
    const items = within(screen.getByRole('list')).getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^Ethos · .*Done$/),
      expect.stringMatching(/^Pathos · .*Done$/),
    ]);
  });

  it('matches no rewrite to a stream that dropped early when pressed before the list could be read', async () => {
    // An older balanced rewrite is still running; the list cannot be read at
    // first, so nothing says it was there before the press.
    const older = row({ id: 'rw_older', focus: 'balanced' });
    let posted = false;
    // Every read before the press fails; the one after it lists the older rewrite.
    routes.list = () =>
      posted ? ok([older]) : refused(500, 'INTERNAL_ERROR', 'Something went wrong.');
    routes.post = () => {
      posted = true;
      return streamed([], 'error');
    };
    render(<RewriteDrawer assessmentId="asm_1" focuses={focuses} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));

    expect(
      await screen.findByText(
        /the earlier rewrites could not be read\. Close this and open it again/
      )
    ).toBeInTheDocument();
    expect(calls('GET', '/api/v1/rewrites/rw_older')).toHaveLength(0);
  });

  it('holds the earlier rewrites still while one is being written', async () => {
    let finish: () => void = () => undefined;
    routes.post = () => {
      const enc = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(frame({ type: 'rewrite', rewrite: row() })));
            finish = () => {
              c.enqueue(
                enc.encode(
                  frame({
                    type: 'rewrite_done',
                    rewrite: row({ status: 'completed', draft: 'Done.' }),
                  })
                )
              );
              c.close();
            };
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    };
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));
    await screen.findByRole('heading', { name: 'Ethos rewrite · writing…' });
    expect(screen.getByRole('button', { name: /Pathos · / })).toBeDisabled();

    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: /Pathos · / })).toBeEnabled());
  });

  it('says to reopen when a stream dropped early and the list could not be read either', async () => {
    let listed = 0;
    routes.list = () =>
      listed++ === 0 ? ok([earlierRow]) : refused(500, 'INTERNAL_ERROR', 'Something went wrong.');
    routes.post = () => streamed([], 'error');
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));
    expect(
      await screen.findByText(
        /the earlier rewrites could not be read\. Close this and open it again/
      )
    ).toBeInTheDocument();
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

  it('words a rate limit as being about rewrites, blaming no one', async () => {
    routes.post = () => refused(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests');
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));
    expect(
      await screen.findByText(
        'Too many rewrites are starting right now. Wait a minute, then try again.'
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
      title: 'Q3 board briefing (rewrite)',
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

  it('says the rewrite could not be read when following it fails, without claiming it still runs', async () => {
    routes.list = () => ok([row({ id: 'rw_run', draft: 'Half' })]);
    routes.read = () => refused(500, 'INTERNAL_ERROR', 'Something went wrong.');
    fireEvent.click(await openDrawer(/Ethos · .*Writing/));
    expect(
      await screen.findByText(
        'The rewrite could not be read. Close this and open it again to see where it got to.'
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

  it('matches a drop only against what the server listed, not rewrites the drawer remembered', async () => {
    // The list cannot be read until after the second press; the first press's
    // rewrite is remembered, but is not the server's word on what was there.
    let posts = 0;
    routes.list = () =>
      posts < 2
        ? refused(500, 'INTERNAL_ERROR', 'Something went wrong.')
        : ok([
            row({ id: 'rw_theirs', focus: 'balanced' }),
            row({ id: 'rw_mine1', focus: 'balanced', status: 'completed', draft: 'One.' }),
          ]);
    routes.post = () => {
      posts++;
      return posts === 1
        ? streamed([
            frame({ type: 'rewrite', rewrite: row({ id: 'rw_mine1', focus: 'balanced' }) }),
            frame({
              type: 'rewrite_done',
              rewrite: row({
                id: 'rw_mine1',
                focus: 'balanced',
                status: 'completed',
                draft: 'One.',
              }),
            }),
          ])
        : streamed([], 'error');
    };
    render(<RewriteDrawer assessmentId="asm_1" focuses={focuses} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));
    await waitFor(() => expect(draftBox()?.textContent).toBe('One.'));
    // The list stays unread: one remembered row is not the history.
    expect(screen.queryByRole('list')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));
    expect(
      await screen.findByText(
        /the earlier rewrites could not be read\. Close this and open it again/
      )
    ).toBeInTheDocument();
    expect(calls('GET', '/api/v1/rewrites/rw_theirs')).toHaveLength(0);
  });

  it('drops an earlier refusal’s usage link when another rewrite is reopened', async () => {
    routes.list = () =>
      ok([row({ id: 'rw_failed', focus: 'pathos', status: 'failed', error: 'Timed out.' })]);
    routes.post = () =>
      refused(402, 'INSUFFICIENT_CREDITS', 'Add credits.', { usagePage: '/usage' });
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));
    await screen.findByRole('link', { name: /usage/ });

    fireEvent.click(screen.getByRole('button', { name: /Pathos · / }));
    expect(await screen.findByText('Timed out.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /usage/ })).toBeNull();
  });

  describe('gaps the writer fills (t-83)', () => {
    const gappy = (over: Partial<RewriteWire> = {}) =>
      row({
        id: 'rw_gappy',
        focus: 'pathos',
        status: 'completed',
        draft: 'From [ADD: monthly price] a month, across [ADD: number of clients] clients.',
        placeholders: [
          { id: 'p1', label: 'monthly price', at: [{ start: 5, end: 25 }] },
          { id: 'p2', label: 'number of clients', at: [{ start: 40, end: 66 }] },
        ],
        ...over,
      });

    /** Open the drawer on a finished rewrite with two gaps, reopened from the list. */
    async function openGappy(over: Partial<RewriteWire> = {}) {
      routes.list = () => ok([gappy(over), earlierRow]);
      render(<RewriteDrawer assessmentId="asm_1" focuses={focuses} />);
      fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
      // The gappy rewrite is the newest of two Pathos ones, so it is listed first.
      const [newest] = await screen.findAllByRole('button', { name: /Pathos · / });
      fireEvent.click(newest);
      await screen.findByRole('heading', { name: 'Facts the editor needs' });
    }

    const fillButton = () => screen.getByRole('button', { name: 'Fill these and rewrite' });
    const gap = (label: string) => screen.getByLabelText<HTMLInputElement>(label);

    it('lists each gap of a finished rewrite as a labelled field, and offers none for a draft without gaps', async () => {
      await openGappy();
      expect(gap('monthly price')).toHaveValue('');
      expect(gap('number of clients')).toHaveValue('');

      const [, older] = screen.getAllByRole('button', { name: /Pathos · / });
      fireEvent.click(older);
      expect(draftBox()?.textContent).toBe('An earlier draft.');
      expect(screen.queryByRole('heading', { name: 'Facts the editor needs' })).toBeNull();
    });

    it('shows no fields while the rewrite is still being written', async () => {
      routes.list = () => ok([gappy({ status: 'running' })]);
      routes.read = () => ok(gappy({ status: 'running' }));
      render(<RewriteDrawer assessmentId="asm_1" focuses={focuses} />);
      fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
      fireEvent.click(await screen.findByRole('button', { name: /Pathos · .*Writing/ }));
      expect(screen.queryByRole('heading', { name: 'Facts the editor needs' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Fill these and rewrite' })).toBeNull();
    });

    it('keeps the button off until a field has text that is not blank', async () => {
      await openGappy();
      expect(fillButton()).toBeDisabled();

      fireEvent.change(gap('monthly price'), { target: { value: '   ' } });
      expect(fillButton()).toBeDisabled();

      fireEvent.change(gap('monthly price'), { target: { value: '£20' } });
      expect(fillButton()).toBeEnabled();
    });

    it('rewrites from the shown draft with the trimmed answers, leaving out the blank, and shows the new draft', async () => {
      routes.post = () =>
        streamed([
          frame({ type: 'rewrite', rewrite: row({ id: 'rw_filled', focus: 'pathos' }) }),
          frame({ type: 'rewrite_text', text: 'From £20 a month.' }),
          frame({
            type: 'rewrite_done',
            rewrite: row({
              id: 'rw_filled',
              focus: 'pathos',
              status: 'completed',
              draft: 'From £20 a month.',
            }),
          }),
        ]);
      await openGappy();
      fireEvent.change(gap('monthly price'), { target: { value: '  £20  ' } });
      fireEvent.change(gap('number of clients'), { target: { value: '  ' } });
      fireEvent.click(fillButton());

      await waitFor(() => expect(draftBox()?.textContent).toBe('From £20 a month.'));
      const posts = calls('POST', '/api/v1/rewrites');
      expect(posts).toHaveLength(1);
      expect(bodyOf(posts[0][1])).toEqual({
        assessmentId: 'asm_1',
        focus: 'pathos',
        fromRewriteId: 'rw_gappy',
        answers: { p1: '£20' },
        stream: true,
      });
      // The finished draft has no gaps left, so the fields are gone with it.
      expect(screen.queryByRole('heading', { name: 'Facts the editor needs' })).toBeNull();
    });

    it('clears what was typed when a fill whose stream dropped is found and followed', async () => {
      // The fill answered p1; its draft's remaining gap is now p1 too, for another fact.
      const filled = row({
        id: 'rw_filled',
        focus: 'pathos',
        status: 'completed',
        draft: 'From £20 a month, across [ADD: number of clients] clients.',
        placeholders: [{ id: 'p1', label: 'number of clients', at: [{ start: 25, end: 51 }] }],
      });
      let listed = 0;
      routes.list = () =>
        listed++ === 0
          ? ok([gappy(), earlierRow])
          : ok([row({ id: 'rw_filled', focus: 'pathos' }), gappy(), earlierRow]);
      routes.post = () => streamed([], 'error');
      routes.read = () => ok(filled);
      render(<RewriteDrawer assessmentId="asm_1" focuses={focuses} />);
      fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
      const [newest] = await screen.findAllByRole('button', { name: /Pathos · / });
      fireEvent.click(newest);
      await screen.findByRole('heading', { name: 'Facts the editor needs' });
      fireEvent.change(gap('monthly price'), { target: { value: '£20' } });
      fireEvent.click(fillButton());

      await waitFor(() => expect(draftBox()?.textContent).toBe(filled.draft));
      expect(calls('POST', '/api/v1/rewrites')).toHaveLength(1);
      // The old p1's answer is not offered as the new p1's.
      expect(await screen.findByLabelText('number of clients')).toHaveValue('');
      expect(fillButton()).toBeDisabled();
    });

    it('puts back the draft and what was typed when the fill is refused, and shows the refusal beside Fill', async () => {
      routes.post = () =>
        refused(402, 'INSUFFICIENT_CREDITS', 'This needs 40 CopyCredits; the workspace has 12.', {
          usagePage: '/usage',
        });
      await openGappy();
      fireEvent.change(gap('monthly price'), { target: { value: '£20' } });
      fireEvent.click(fillButton());

      const message = await screen.findByText('This needs 40 CopyCredits; the workspace has 12.');
      expect(screen.getByRole('link', { name: /usage/ })).toHaveAttribute('href', '/usage');
      // The previous draft is shown again, with its fields and the typed answer.
      expect(draftBox()?.textContent).toBe(gappy().draft);
      expect(gap('monthly price')).toHaveValue('£20');
      expect(fillButton()).toBeEnabled();
      // Beside Fill, in the gaps section, not beside "Write a rewrite".
      const gapsSection = screen
        .getByRole('heading', { name: 'Facts the editor needs' })
        .closest('section');
      expect(gapsSection).toContainElement(message);
      expect(calls('POST', '/api/v1/rewrites')).toHaveLength(1);
    });

    it('puts back the draft for a fill refused as invalid (400), with the server’s words', async () => {
      routes.post = () => refused(400, 'VALIDATION_ERROR', 'An answer is too long.');
      await openGappy();
      fireEvent.change(gap('number of clients'), { target: { value: '300' } });
      fireEvent.click(fillButton());

      expect(await screen.findByText(/An answer is too long\./)).toBeInTheDocument();
      expect(gap('number of clients')).toHaveValue('300');
      expect(draftBox()?.textContent).toBe(gappy().draft);
    });

    it('shows a refused plain rewrite beside Write a rewrite, not beside Fill', async () => {
      routes.post = () => refused(402, 'INSUFFICIENT_CREDITS', 'Add credits.');
      await openGappy();
      const write = screen.getByRole('button', { name: 'Write a rewrite' });
      fireEvent.click(write);

      const message = await screen.findByText('Add credits.');
      expect(write.parentElement).toContainElement(message);
      // A plain rewrite replaces the shown draft for its attempt, so no fields remain to host it.
      expect(screen.queryByRole('button', { name: 'Fill these and rewrite' })).toBeNull();
    });
  });

  describe('the invitation to write a brief (t-83)', () => {
    it('shows none when the drawer is given none', async () => {
      await openDrawer();
      expect(screen.queryByRole('complementary', { name: 'Add a brief' })).toBeNull();
    });

    it('shows none for a null invitation', async () => {
      render(<RewriteDrawer assessmentId="asm_1" focuses={focuses} briefInvite={null} />);
      fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
      await screen.findByRole('button', { name: /Pathos · / });
      expect(screen.queryByRole('complementary', { name: 'Add a brief' })).toBeNull();
    });

    it('links a project with no brief to the project’s page', async () => {
      render(
        <RewriteDrawer
          assessmentId="asm_1"
          focuses={focuses}
          briefInvite={{ projectId: 'prj_1' }}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
      const invite = await screen.findByRole('complementary', { name: 'Add a brief' });
      expect(
        within(invite).getByRole('link', { name: 'Write the project’s brief' })
      ).toHaveAttribute('href', '/projects/prj_1');
    });

    it('links copy in no project to the projects page', async () => {
      render(
        <RewriteDrawer assessmentId="asm_1" focuses={focuses} briefInvite={{ projectId: null }} />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
      const invite = await screen.findByRole('complementary', { name: 'Add a brief' });
      expect(
        within(invite).getByRole('link', { name: 'Make a project with a brief' })
      ).toHaveAttribute('href', '/projects');
    });

    it('still writes a rewrite with the invitation shown', async () => {
      render(
        <RewriteDrawer assessmentId="asm_1" focuses={focuses} briefInvite={{ projectId: null }} />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
      await screen.findByRole('complementary', { name: 'Add a brief' });
      fireEvent.click(screen.getByRole('button', { name: 'Write a rewrite' }));

      await waitFor(() => expect(draftBox()?.textContent).toBe('A better draft.'));
      expect(bodyOf(calls('POST', '/api/v1/rewrites')[0][1])).toEqual({
        assessmentId: 'asm_1',
        focus: 'balanced',
        stream: true,
      });
    });
  });
});
