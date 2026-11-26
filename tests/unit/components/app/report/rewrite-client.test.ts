// @vitest-environment happy-dom

/**
 * The report drawer's calls to the rewrites API (t-82).
 *
 * @see components/app/report/rewrite-client.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIClientError } from '@/lib/api/client';
import { createComparisonSchema } from '@/lib/app/comparisons/validations';
import {
  answersFor,
  compareDraftBody,
  compareDraftRefusalOf,
  followRewrite,
  mergeRewrites,
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
  placeholders: [],
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
      { focus: 'ethos' },
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
      { focus: 'balanced' },
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
      { focus: 'balanced' },
      { onStart: vi.fn(), onText: vi.fn() },
      new AbortController().signal
    );
    expect(outcome).toEqual({ kind: 'dropped', rewrite: row(), sentAt: expect.any(Number) });
  });

  it('reports a stream that ends before its first event as dropped, with no row', async () => {
    fetchMock.mockResolvedValue(streamed([]));
    const outcome = await streamRewrite(
      'asm_1',
      { focus: 'balanced' },
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
      { focus: 'balanced' },
      { onStart: vi.fn(), onText: vi.fn() },
      new AbortController().signal
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIClientError);
    expect(err).toMatchObject({ code: 'INSUFFICIENT_CREDITS', status: 402 });
  });
});

describe('streamRewrite: the stream’s end', () => {
  it('reads a last frame the stream ended without its blank line', async () => {
    const done = frame({ type: 'rewrite_done', rewrite: row({ status: 'completed' }) });
    fetchMock.mockResolvedValue(
      streamed([frame({ type: 'rewrite', rewrite: row() }), done.slice(0, -2)])
    );
    const outcome = await streamRewrite(
      'asm_1',
      { focus: 'balanced' },
      { onStart: vi.fn(), onText: vi.fn() },
      new AbortController().signal
    );
    expect(outcome).toEqual({ kind: 'done', rewrite: row({ status: 'completed' }) });
  });

  it('lets the response go once rewrite_done is read, though the server has not closed it', async () => {
    const cancelled = vi.fn();
    const enc = new TextEncoder();
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(
              enc.encode(frame({ type: 'rewrite_done', rewrite: row({ status: 'completed' }) }))
            );
            // Never closed: keepalives could follow.
          },
          cancel: cancelled,
        })
      )
    );
    const outcome = await streamRewrite(
      'asm_1',
      { focus: 'balanced' },
      { onStart: vi.fn(), onText: vi.fn() },
      new AbortController().signal
    );
    expect(outcome.kind).toBe('done');
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalled());
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
  const asked = { sentAt, focus: 'balanced', known: new Set<string>(['rw_listed']) };

  it('finds the newest running rewrite of the focus asked for, new since the request', () => {
    const mine = row({ id: 'rw_new', createdAt: '2026-11-25T10:00:01.000Z' });
    expect(startedSince([mine, row({ id: 'rw_old', status: 'completed' })], asked)).toBe(mine);
  });

  it('passes over a rewrite of another focus, or one listed before the request', () => {
    const otherFocus = row({
      id: 'rw_pathos',
      focus: 'pathos',
      createdAt: '2026-11-25T10:00:02.000Z',
    });
    const listedBefore = row({ id: 'rw_listed', createdAt: '2026-11-25T09:59:50.000Z' });
    expect(startedSince([otherFocus, listedBefore], asked)).toBeNull();
    const mine = row({ id: 'rw_new', createdAt: '2026-11-25T10:00:01.000Z' });
    expect(startedSince([otherFocus, mine, listedBefore], asked)).toBe(mine);
  });

  it('finds none that has ended, is from long before, or when there are none', () => {
    expect(startedSince([row({ status: 'completed' })], asked)).toBeNull();
    expect(startedSince([row({ createdAt: '2026-11-25T09:00:00.000Z' })], asked)).toBeNull();
    expect(startedSince([], asked)).toBeNull();
  });
});

describe('mergeRewrites', () => {
  it('keeps a rewrite seen since a list read that does not have it, newest first', () => {
    const listed = [
      row({ id: 'rw_old', createdAt: '2026-11-24T10:00:00.000Z', status: 'completed' }),
    ];
    const started = row({ id: 'rw_new', createdAt: '2026-11-25T10:00:00.000Z' });
    expect(mergeRewrites(listed, [started]).map((r) => r.id)).toEqual(['rw_new', 'rw_old']);
  });

  it('keeps whichever copy of a row is further on', () => {
    const running = row({ draft: 'He' });
    const ended = row({ status: 'completed', draft: 'Hello' });
    expect(mergeRewrites([running], [ended])[0]).toBe(ended);
    expect(mergeRewrites([ended], [running])[0]).toBe(ended);
    const longer = row({ draft: 'Hello wor' });
    expect(mergeRewrites([running], [longer])[0]).toBe(longer);
  });
});

describe('rewriteRefusalOf', () => {
  it('words a rate limit as being about rewrites, blaming no one', () => {
    expect(rewriteRefusalOf(new APIClientError('x', 'RATE_LIMIT_EXCEEDED', 429))).toEqual({
      message: 'Too many rewrites are starting right now. Wait a minute, then try again.',
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

describe('compareDraftBody (t-84)', () => {
  const original = {
    id: 'asm_1',
    title: 'Q3 board briefing',
    text: 'The original.',
    framework: { slug: 'howdoesthisland', version: '0.5.1' },
    context: { contentType: 'proposal', audience: { awareness: 'aware' } },
    projectId: 'prj_1',
    judges: ['judge_ethos', 'judge_logos'],
  };
  const draft = { text: 'The draft.', focusName: 'Balanced' };

  it('compares the draft with the original’s review, reviewed with its version, context, project and AI reviewers', () => {
    expect(compareDraftBody(original, draft)).toEqual({
      drafts: [
        { assessmentId: 'asm_1', label: 'Q3 board briefing' },
        { text: 'The draft.', label: 'Q3 board briefing (balanced rewrite)' },
      ],
      framework: 'howdoesthisland',
      version: '0.5.1',
      context: { contentType: 'proposal', audience: { awareness: 'aware' } },
      projectId: 'prj_1',
      judges: ['judge_ethos', 'judge_logos'],
    });
  });

  it('sends the original’s copy to be reviewed again only when asked to', () => {
    expect(compareDraftBody(original, draft, true).drafts).toEqual([
      { text: 'The original.', label: 'Q3 board briefing' },
      { text: 'The draft.', label: 'Q3 board briefing (balanced rewrite)' },
    ]);
  });

  it('reviews a quick review’s draft quickly, and leaves out what the original had none of', () => {
    expect(
      compareDraftBody(
        { ...original, title: null, context: null, projectId: null, judges: [] },
        { text: 'The draft.', focusName: 'Pathos' }
      )
    ).toEqual({
      drafts: [
        { assessmentId: 'asm_1', label: 'Original' },
        { text: 'The draft.', label: 'Pathos rewrite' },
      ],
      framework: 'howdoesthisland',
      version: '0.5.1',
      profile: 'quick',
    });
  });

  it('keeps each label within the 80 UTF-16 units the server counts, never cutting a character in half', () => {
    const [first, second] = compareDraftBody(
      { ...original, title: `${'x'.repeat(59)}😀😀${'y'.repeat(30)}` },
      draft
    ).drafts as { label: string }[];
    // An emoji is two units: 59 + 2 + 2 + 17 = 80.
    expect(first.label).toBe(`${'x'.repeat(59)}😀😀${'y'.repeat(17)}`);
    expect(first.label).toHaveLength(80);
    // 80 − 19 for the suffix leaves 61: one emoji fits, the second would split.
    expect(second.label).toBe(`${'x'.repeat(59)}😀 (balanced rewrite)`);
    expect(second.label).toHaveLength(80);
  });

  it('is a body the server takes, for a title of emoji alone', () => {
    const body = compareDraftBody({ ...original, title: '🚀'.repeat(60) }, draft);
    const parsed = createComparisonSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    const [first, second] = body.drafts as { label: string }[];
    expect(first.label).toBe('🚀'.repeat(40));
    expect(second.label).toBe(`${'🚀'.repeat(30)} (balanced rewrite)`);
  });

  it('keeps the draft’s label within the limit when its rewrite’s name alone fills it', () => {
    const [, second] = compareDraftBody(original, { ...draft, focusName: 'z'.repeat(90) })
      .drafts as { label: string }[];
    expect(second.label.length).toBeLessThanOrEqual(80);
    expect(
      createComparisonSchema.safeParse(
        compareDraftBody(original, { ...draft, focusName: 'z'.repeat(90) })
      ).success
    ).toBe(true);
  });
});

describe('compareDraftRefusalOf (t-84)', () => {
  it('says a retired model version cannot review the draft, rather than to reload', () => {
    expect(
      compareDraftRefusalOf(new APIClientError('x', 'FRAMEWORK_VERSION_NOT_FOUND', 404))
    ).toEqual({
      message:
        'The model this review ran on has been retired, so the draft cannot be reviewed the same way. Copy it, and review it from the assess page.',
      usagePage: null,
      reviewAgain: false,
    });
  });

  it('offers reviewing both again when the original’s review no longer compares', () => {
    const refusal = compareDraftRefusalOf(
      new APIClientError('x', 'REVIEW_NOT_COMPARABLE', 409, {
        position: 0,
        reason: 'options_differ',
        differs: ['weights'],
      })
    );
    expect(refusal).toMatchObject({ reviewAgain: true, usagePage: null });
    expect(refusal?.message).toMatch(/Review both again/);
  });

  it('offers it for a review only partly scored, saying so rather than blaming settings', () => {
    const refusal = compareDraftRefusalOf(
      new APIClientError('x', 'REVIEW_NOT_COMPARABLE', 409, {
        position: 0,
        reason: 'partly_scored',
      })
    );
    expect(refusal).toMatchObject({ reviewAgain: true, usagePage: null });
    expect(refusal?.message).toMatch(/only partly scored/);
    expect(refusal?.message).not.toMatch(/settings/);
  });

  it('does not offer it for a review with no score, which reviewing the draft cannot help', () => {
    expect(
      compareDraftRefusalOf(
        new APIClientError('x', 'REVIEW_NOT_COMPARABLE', 409, { position: 0, reason: 'not_scored' })
      )
    ).toMatchObject({ reviewAgain: false });
  });

  it('words the rest as the assess page does', () => {
    expect(
      compareDraftRefusalOf(new APIClientError('Add credits.', 'INSUFFICIENT_CREDITS', 402))
    ).toEqual({ message: 'Add credits.', usagePage: '/usage', reviewAgain: false });
    expect(compareDraftRefusalOf(new Error('x'))).toBeNull();
  });
});

describe('streamRewrite: filling gaps (t-83)', () => {
  it('sends the rewrite it fills and the answers beside the focus, still streamed', async () => {
    fetchMock.mockResolvedValue(
      streamed([
        frame({ type: 'rewrite_done', rewrite: row({ status: 'completed', draft: 'Done.' }) }),
      ])
    );

    await streamRewrite(
      'asm_1',
      { focus: 'pathos', fromRewriteId: 'rw_prev', answers: { p1: '£20 a month', p2: 'Leeds' } },
      { onStart: vi.fn(), onText: vi.fn() },
      new AbortController().signal
    );

    expect(bodyOf(fetchMock.mock.calls[0][1])).toEqual({
      assessmentId: 'asm_1',
      focus: 'pathos',
      fromRewriteId: 'rw_prev',
      answers: { p1: '£20 a month', p2: 'Leeds' },
      stream: true,
    });
  });

  it('never lets the ask turn streaming off', async () => {
    fetchMock.mockResolvedValue(streamed([]));
    await streamRewrite(
      'asm_1',
      { focus: 'balanced', ...({ stream: false } as object) },
      { onStart: vi.fn(), onText: vi.fn() },
      new AbortController().signal
    );
    expect(bodyOf(fetchMock.mock.calls[0][1])).toMatchObject({ stream: true });
  });
});

describe('answersFor', () => {
  const placeholders = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];

  it('keeps each answer trimmed, by id, and leaves out the blank and the unanswered', () => {
    expect(answersFor(placeholders, { p1: '  £20 a month  ', p2: '   ' })).toEqual({
      p1: '£20 a month',
    });
  });

  it('ignores text typed for an id that is not one of the placeholders', () => {
    expect(answersFor(placeholders, { p1: 'Yes', gone: 'Stale answer' })).toEqual({ p1: 'Yes' });
  });

  it('is empty when nothing is answered, so there is nothing to rewrite with', () => {
    expect(answersFor(placeholders, {})).toEqual({});
    expect(answersFor(placeholders, { p1: '\n\t ' })).toEqual({});
  });
});
