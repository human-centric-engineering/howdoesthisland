// @vitest-environment happy-dom

/**
 * The report drawer's calls to the rewrites API (t-82).
 *
 * @see components/app/report/rewrite-client.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIClientError } from '@/lib/api/client';
import {
  followRewrite,
  reviewDraftBody,
  rewriteRefusalOf,
  startedSince,
  streamRewrite,
  type RewriteWire,
} from '@/components/app/report/rewrite-client';

/** A fetch call's URL, whichever form it was given in. */
const urlOf = (u: RequestInfo | URL): string =>
  typeof u === 'string' ? u : u instanceof URL ? u.href : u.url;
/** A fetch call's JSON body. */
const bodyOf = (init?: RequestInit): unknown =>
  JSON.parse(typeof init?.body === 'string' ? init.body : 'null');

const row = (over: Partial<RewriteWire> = {}): RewriteWire => ({
  id: 'rw_1',
  assessmentId: 'asm_1',
  focus: 'balanced',
  status: 'running',
  draft: '',
  error: null,
  errorCode: null,
  model: 'm',
  costUsd: 0,
  createdAt: '2026-11-25T10:00:00.000Z',
  completedAt: null,
  ...over,
});

/** An SSE frame as `sseResponse` writes it. */
const frame = (event: { type: string } & Record<string, unknown>): string =>
  `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

/** A streamed response whose body arrives in `chunks`, then ends (or errors). */
function streamed(chunks: string[], end: 'close' | 'error' = 'close'): Response {
  const enc = new TextEncoder();
  const queue = [...chunks];
  // One chunk per read, so an error comes after every chunk has been read.
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      const next = queue.shift();
      if (next !== undefined) c.enqueue(enc.encode(next));
      else if (end === 'close') c.close();
      else c.error(new TypeError('network error'));
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('streamRewrite', () => {
  it('posts a streamed rewrite and passes each piece on, across chunk boundaries', async () => {
    const all =
      frame({ type: 'rewrite', rewrite: row() }) +
      frame({ type: 'rewrite_text', text: 'Hello ' }) +
      frame({ type: 'rewrite_text', text: 'world' }) +
      frame({ type: 'rewrite_done', rewrite: row({ status: 'completed', draft: 'Hello world' }) });
    // Cut mid-frame, so a frame is only read once it is whole.
    fetchMock.mockResolvedValue(streamed([all.slice(0, 37), all.slice(37, 120), all.slice(120)]));
    const onStart = vi.fn();
    const pieces: string[] = [];

    const outcome = await streamRewrite(
      'asm_1',
      'ethos',
      { onStart, onText: (t) => pieces.push(t) },
      new AbortController().signal
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/rewrites');
    expect(init?.method).toBe('POST');
    expect(bodyOf(init)).toEqual({
      assessmentId: 'asm_1',
      focus: 'ethos',
      stream: true,
    });
    expect(onStart).toHaveBeenCalledWith(row());
    expect(pieces.join('')).toBe('Hello world');
    expect(outcome).toEqual({
      kind: 'done',
      rewrite: row({ status: 'completed', draft: 'Hello world' }),
    });
  });

  it('passes over a frame it cannot read, such as the sanitised error frame', async () => {
    fetchMock.mockResolvedValue(
      streamed([
        frame({ type: 'rewrite', rewrite: row() }),
        frame({ type: 'error', code: 'stream_error', message: 'x' }),
        ': keepalive\n\n',
        frame({ type: 'rewrite_done', rewrite: row({ status: 'failed', error: 'stopped' }) }),
      ])
    );
    const outcome = await streamRewrite(
      'asm_1',
      'balanced',
      { onStart: vi.fn(), onText: vi.fn() },
      new AbortController().signal
    );
    expect(outcome.kind).toBe('done');
  });

  it('reports a stream that ends before rewrite_done as dropped, with the row it started', async () => {
    fetchMock.mockResolvedValue(
      streamed(
        [frame({ type: 'rewrite', rewrite: row() }), frame({ type: 'rewrite_text', text: 'Hel' })],
        'error'
      )
    );
    const outcome = await streamRewrite(
      'asm_1',
      'balanced',
      { onStart: vi.fn(), onText: vi.fn() },
      new AbortController().signal
    );
    expect(outcome).toEqual({ kind: 'dropped', rewrite: row(), sentAt: expect.any(Number) });
  });

  it('reports a stream that ends before its first event as dropped, with no row', async () => {
    fetchMock.mockResolvedValue(streamed([]));
    const outcome = await streamRewrite(
      'asm_1',
      'balanced',
      { onStart: vi.fn(), onText: vi.fn() },
      new AbortController().signal
    );
    expect(outcome).toMatchObject({ kind: 'dropped', rewrite: null });
  });

  it('throws the route’s refusal with its code and details', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          success: false,
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: 'Add credits.',
            details: { usagePage: '/usage' },
          },
        },
        402
      )
    );
    const err = await streamRewrite(
      'asm_1',
      'balanced',
      { onStart: vi.fn(), onText: vi.fn() },
      new AbortController().signal
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIClientError);
    expect(err).toMatchObject({ code: 'INSUFFICIENT_CREDITS', status: 402 });
  });
});

describe('followRewrite', () => {
  it('reads the rewrite again until it ends, passing on each read', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ success: true, data: row({ draft: 'He' }) }))
      .mockResolvedValueOnce(json({ success: true, data: row({ draft: 'Hello' }) }))
      .mockResolvedValueOnce(
        json({ success: true, data: row({ status: 'completed', draft: 'Hello world' }) })
      );
    const seen: string[] = [];

    const ended = await followRewrite(
      'rw_1',
      (r) => seen.push(r.draft),
      new AbortController().signal,
      1
    );

    expect(fetchMock.mock.calls.map(([u]) => urlOf(u))).toEqual([
      '/api/v1/rewrites/rw_1',
      '/api/v1/rewrites/rw_1',
      '/api/v1/rewrites/rw_1',
    ]);
    expect(seen).toEqual(['He', 'Hello', 'Hello world']);
    expect(ended.status).toBe('completed');
    // Reading never posts: a rewrite is never started again.
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('stops reading when aborted', async () => {
    fetchMock.mockResolvedValue(json({ success: true, data: row() }));
    const controller = new AbortController();
    const following = followRewrite('rw_1', () => controller.abort(), controller.signal, 60_000);
    await expect(following).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('startedSince', () => {
  const sentAt = Date.parse('2026-11-25T10:00:00.000Z');

  it('finds the newest rewrite when it is running and no older than the request', () => {
    const newest = row({ id: 'rw_new', createdAt: '2026-11-25T10:00:01.000Z' });
    expect(startedSince([newest, row({ id: 'rw_old', status: 'completed' })], sentAt)).toBe(newest);
  });

  it('finds none when the newest has ended, is from long before, or there are none', () => {
    expect(startedSince([row({ status: 'completed' })], sentAt)).toBeNull();
    expect(startedSince([row({ createdAt: '2026-11-25T09:00:00.000Z' })], sentAt)).toBeNull();
    expect(startedSince([], sentAt)).toBeNull();
  });
});

describe('rewriteRefusalOf', () => {
  it('words a rate limit as being about rewrites', () => {
    expect(rewriteRefusalOf(new APIClientError('x', 'RATE_LIMIT_EXCEEDED', 429))).toEqual({
      message:
        'You have started a lot of rewrites in the last minute. Wait a minute, then try again.',
      usagePage: null,
    });
  });

  it('words credit and budget refusals as the assess page does, linking the usage page', () => {
    expect(
      rewriteRefusalOf(
        new APIClientError('Add credits.', 'INSUFFICIENT_CREDITS', 402, { usagePage: '/usage' })
      )
    ).toEqual({ message: 'Add credits.', usagePage: '/usage' });
  });

  it('leaves the rest to the server’s own message', () => {
    expect(rewriteRefusalOf(new APIClientError('x', 'ASSESSMENT_NOT_REWRITABLE', 409))).toBeNull();
    expect(rewriteRefusalOf(new Error('x'))).toBeNull();
  });
});

describe('reviewDraftBody', () => {
  const original = {
    framework: { slug: 'howdoesthisland', version: '0.5.1' },
    context: { contentType: 'proposal', audience: { awareness: 'aware' } },
    projectId: 'prj_1',
    judges: ['judge_ethos', 'judge_logos'],
  };

  it('reviews the draft with the original’s version, context, project and AI reviewers', () => {
    expect(reviewDraftBody(original, 'The draft.')).toEqual({
      source: { text: 'The draft.' },
      framework: 'howdoesthisland',
      version: '0.5.1',
      context: { contentType: 'proposal', audience: { awareness: 'aware' } },
      projectId: 'prj_1',
      judges: ['judge_ethos', 'judge_logos'],
    });
  });

  it('reviews a quick review’s draft quickly, and leaves out what the original had none of', () => {
    expect(
      reviewDraftBody({ ...original, context: null, projectId: null, judges: [] }, 'The draft.')
    ).toEqual({
      source: { text: 'The draft.' },
      framework: 'howdoesthisland',
      version: '0.5.1',
      profile: 'quick',
    });
  });
});
