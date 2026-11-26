'use client';

/**
 * The report drawer's calls to the rewrites API (t-82,
 * `.context/app/rewrites.md`), apart from the drawer so each is tested on its
 * own.
 *
 * - {@link streamRewrite}: `POST /api/v1/rewrites` with `stream: true`, read
 *   piece by piece.
 * - {@link followRewrite}: `GET /api/v1/rewrites/{id}` until it ends, for one
 *   reopened while it runs, or whose stream dropped. A dropped stream is
 *   never answered with a second `POST`: that would be a second, charged
 *   rewrite, while the first carries on regardless.
 * - {@link compareDraftBody}: the comparison of a draft with its original
 *   (t-84), the draft reviewed the way the original was.
 */
import { z } from 'zod';
import { APIClientError, apiClient, apiErrorFromResponse } from '@/lib/api/client';
import { parseSseBlock } from '@/lib/api/sse-parser';
import { rewriteEventSchema, rewriteSchema } from '@/lib/app/rewrites/wire';
import { DRAFT_LABEL_MAX } from '@/lib/app/comparisons/limits';
import { refusalOf, type Refusal } from '@/components/app/workbench/assess-draft';

export type RewriteWire = z.infer<typeof rewriteSchema>;

export const REWRITES_ENDPOINT = '/api/v1/rewrites';
export const rewritePath = (id: string): string => `${REWRITES_ENDPOINT}/${encodeURIComponent(id)}`;

const rewritesSchema = z.array(rewriteSchema);

/** A review's rewrites, newest first (`GET /api/v1/rewrites?assessmentId=`). */
export async function listRewrites(assessmentId: string): Promise<RewriteWire[]> {
  return rewritesSchema.parse(
    await apiClient.get<unknown>(REWRITES_ENDPOINT, { params: { assessmentId } })
  );
}

/** One rewrite, as last saved. */
export async function readRewrite(id: string): Promise<RewriteWire> {
  return rewriteSchema.parse(await apiClient.get<unknown>(rewritePath(id)));
}

export type StreamOutcome =
  /** `rewrite_done` arrived: the rewrite as it ended. */
  | { kind: 'done'; rewrite: RewriteWire }
  /**
   * The stream ended, or broke, before `rewrite_done`. `rewrite` is the row
   * from the first event when it arrived: the rewrite carries on on the
   * server either way, and `followRewrite` reads it to its end.
   */
  | { kind: 'dropped'; rewrite: RewriteWire | null; sentAt: number };

/**
 * What a rewrite is asked for: its focus, and for one that fills an earlier
 * rewrite's gaps (t-83), that rewrite and the answers, by placeholder id.
 */
export interface RewriteAsk {
  focus: string;
  fromRewriteId?: string;
  answers?: Record<string, string>;
}

export interface StreamHandlers {
  /** The row, `running`: the rewrite exists, and is being charged for. */
  onStart: (rewrite: RewriteWire) => void;
  /** A piece of the draft, in order. */
  onText: (text: string) => void;
}

/**
 * Start a rewrite and read its stream.
 *
 * @throws APIClientError — the route's refusal before anything started
 *   (402, 409, 429, …), or a network failure before it answered
 */
export async function streamRewrite(
  assessmentId: string,
  ask: RewriteAsk,
  handlers: StreamHandlers,
  signal: AbortSignal
): Promise<StreamOutcome> {
  const sentAt = Date.now();
  let response: Response;
  try {
    response = await fetch(REWRITES_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ assessmentId, ...ask, stream: true }),
      signal,
    });
  } catch (err) {
    throw new APIClientError(
      err instanceof Error ? err.message : 'Network request failed',
      'NETWORK_ERROR'
    );
  }
  if (!response.ok) throw await apiErrorFromResponse(response);

  let started: RewriteWire | null = null;
  if (!response.body) return { kind: 'dropped', rewrite: null, sentAt };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  /** One block's event: the ended row for `rewrite_done`, else `null`. */
  const handle = (block: string): RewriteWire | null => {
    const frame = parseSseBlock(block);
    if (!frame) return null;
    const event = rewriteEventSchema.safeParse(frame.data);
    // An event this page cannot read (the sanitised `error` frame among
    // them) is passed over: the row says how it ended.
    if (!event.success) return null;
    if (event.data.type === 'rewrite') {
      started = event.data.rewrite;
      handlers.onStart(started);
    } else if (event.data.type === 'rewrite_text') {
      handlers.onText(event.data.text);
    } else {
      return event.data.rewrite;
    }
    return null;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        // A last block the stream ended without its blank line.
        buffer += decoder.decode();
        const ended = buffer.trim() ? handle(buffer) : null;
        if (ended) return { kind: 'done', rewrite: ended };
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const ended = handle(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
        if (ended) return { kind: 'done', rewrite: ended };
      }
    }
  } catch (err) {
    // Closed by the reader (the drawer shut, the page left): nothing to follow.
    if (signal.aborted) throw err;
  } finally {
    // Done with the response, however it ended: let its connection go.
    reader.cancel().catch(() => undefined);
  }
  return { kind: 'dropped', rewrite: started, sentAt };
}

/** How long before the request a rewrite found after a drop may have been started. */
const STARTED_SLACK_MS = 60_000;

/**
 * The rewrite a stream that dropped before its first event started, if it
 * started one: the newest of the review's list that is still running, has
 * the focus asked for, was not listed before the request (`known`), and is
 * no older than the request but for clock skew (`STARTED_SLACK_MS`).
 * `null` when there is none.
 *
 * Someone else starting the same focus on the same review in that window
 * still matches: nothing on the row says who started it.
 */
export function startedSince(
  list: readonly RewriteWire[],
  asked: { sentAt: number; focus: string; known: ReadonlySet<string> }
): RewriteWire | null {
  return (
    list.find(
      (r) =>
        r.status === 'running' &&
        r.focus === asked.focus &&
        !asked.known.has(r.id) &&
        Date.parse(r.createdAt) >= asked.sentAt - STARTED_SLACK_MS
    ) ?? null
  );
}

/**
 * A review's list, read from the server, with the rows the drawer has seen
 * since: a list read before a rewrite started does not hide it. Where both
 * have a row, the one further on (ended, or with more draft) is kept.
 * Newest first.
 */
export function mergeRewrites(
  listed: readonly RewriteWire[],
  seen: Iterable<RewriteWire>
): RewriteWire[] {
  const byId = new Map(listed.map((r) => [r.id, r]));
  for (const r of seen) {
    const other = byId.get(r.id);
    if (!other || isFurther(r, other)) byId.set(r.id, r);
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

const isFurther = (a: RewriteWire, b: RewriteWire): boolean =>
  b.status === 'running' && (a.status !== 'running' || a.draft.length > b.draft.length);

/** How often a running rewrite is read again. The server saves its draft every 5s. */
export const FOLLOW_EVERY_MS = 3_000;

/**
 * Read a rewrite until it is no longer `running`, passing each read on.
 * Resolves with the ended row; rejects when `signal` aborts, or a read fails.
 */
export async function followRewrite(
  id: string,
  onUpdate: (rewrite: RewriteWire) => void,
  signal: AbortSignal,
  everyMs: number = FOLLOW_EVERY_MS
): Promise<RewriteWire> {
  while (true) {
    const rewrite = await readRewrite(id);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    onUpdate(rewrite);
    if (rewrite.status !== 'running') return rewrite;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, everyMs);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

/**
 * A rewrite's refusal, in words a person can act on: the assess page's
 * (`refusalOf`), with rewrite wording for those that are about rewrites.
 * `null` for the rest, whose server message is shown as it is.
 */
export function rewriteRefusalOf(err: unknown): Refusal | null {
  if (!(err instanceof APIClientError)) return null;
  switch (err.code) {
    // Over the per-user cap, or a burst of the workspace's requests kept the
    // budget check from its lock: either way, waiting is the remedy.
    case 'RATE_LIMIT_EXCEEDED':
      return {
        message: 'Too many rewrites are starting right now. Wait a minute, then try again.',
        usagePage: null,
      };
    default:
      return refusalOf(err);
  }
}

/**
 * A refused comparison of a draft with its original (t-84), in words a
 * person can act on: the assess page's, but for a retired model version
 * (reloading cannot help, since the draft is reviewed with its original's)
 * and an original that no longer compares. `reviewAgain` is set when sending
 * the original as text, reviewed beside the draft, would compare them.
 */
export function compareDraftRefusalOf(err: unknown): (Refusal & { reviewAgain: boolean }) | null {
  if (err instanceof APIClientError && err.code === 'FRAMEWORK_VERSION_NOT_FOUND') {
    return {
      message:
        'The model this review ran on has been retired, so the draft cannot be reviewed the same way. Copy it, and review it from the assess page.',
      usagePage: null,
      reviewAgain: false,
    };
  }
  if (err instanceof APIClientError && err.code === 'REVIEW_NOT_COMPARABLE') {
    const reason = notComparableReason.safeParse(err.details).data?.reason;
    if (reason === 'not_scored') {
      return {
        message: 'This review has no score to compare the draft with.',
        usagePage: null,
        reviewAgain: false,
      };
    }
    // Only a review that would compare once reviewed again is worth offering
    // that, charged; any other reason is the server's to say.
    if (reason !== 'partly_scored' && reason !== 'options_differ') {
      return { message: err.message, usagePage: null, reviewAgain: false };
    }
    return {
      message:
        reason === 'partly_scored'
          ? 'This review was only partly scored, so the draft could not be weighed against it. Review both again to compare them: that is charged as two reviews and the editor’s verdict on them.'
          : 'This review was made with settings that have changed since, so its scores would not compare with a new review of the draft. Review both again to compare them: that is charged as two reviews and the editor’s verdict on them.',
      usagePage: null,
      reviewAgain: true,
    };
  }
  const refusal = refusalOf(err);
  return refusal ? { ...refusal, reviewAgain: false } : null;
}

const notComparableReason = z.object({ reason: z.string() });

/**
 * The answers worth sending for `placeholders`: each one filled in, trimmed,
 * keyed by its id. Empty when none is, so there is nothing to rewrite with.
 */
export function answersFor(
  placeholders: readonly { id: string }[],
  typed: Readonly<Record<string, string>>
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const { id } of placeholders) {
    const answer = typed[id]?.trim();
    if (answer) answers[id] = answer;
  }
  return answers;
}

/** Why a rewrite failed, as the server put it; what it had written stays shown. */
export function failureMessage(rewrite: RewriteWire): string {
  return rewrite.error ?? 'The rewrite could not be finished. Try again.';
}

/** The parts of `GET /api/v1/assessments/{id}` a review of its rewrite repeats. */
export const originalReviewSchema = z.object({
  title: z.string().nullable(),
  /** The original copy: sent again only when its review cannot be reused. */
  text: z.string(),
  framework: z.object({ slug: z.string(), version: z.string() }),
  context: z.record(z.string(), z.unknown()).nullable(),
  projectId: z.string().nullable(),
  judges: z.array(z.string()),
});
export type OriginalReview = z.infer<typeof originalReviewSchema>;

/**
 * `text` cut to at most `max` UTF-16 code units, as the server's `.max()`
 * counts a label, never splitting a character (an emoji is two units).
 */
function cut(text: string, max: number): string {
  let out = '';
  for (const char of text) {
    if (out.length + char.length > max) break;
    out += char;
  }
  return out.trimEnd();
}

/**
 * `POST /api/v1/comparisons` of a draft with the review it was rewritten
 * from (t-84): the draft reviewed as its original was, with the same model
 * version, reader context, project and AI reviewers. A quick review called
 * none, so it is quick again (`judges` takes at least one).
 *
 * The original joins by its review's id, so it is not reviewed or charged
 * again; the draft's review is, and so is the editor's verdict on the two
 * when the review calls enough AI reviewers for one (t-88). With `reviewAgain`, when that review no longer compares (its
 * project's settings changed since), its copy is sent as text instead and
 * reviewed beside the draft.
 *
 * Each draft is labelled with the review's title, the draft's saying which
 * rewrite it is; the draft's review is titled with its label.
 */
export function compareDraftBody(
  original: OriginalReview & { id: string },
  draft: { text: string; focusName: string },
  reviewAgain = false
): Record<string, unknown> {
  const title = original.title?.trim() ? cut(original.title.trim(), DRAFT_LABEL_MAX) : '';
  const kind = `${draft.focusName.toLowerCase()} rewrite`;
  const suffix = ` (${kind})`;
  const draftLabel = title
    ? cut(`${cut(title, Math.max(0, DRAFT_LABEL_MAX - suffix.length))}${suffix}`, DRAFT_LABEL_MAX)
    : cut(`${draft.focusName} rewrite`, DRAFT_LABEL_MAX);
  const originalLabel = title || 'Original';
  return {
    drafts: [
      reviewAgain
        ? { text: original.text, label: originalLabel }
        : { assessmentId: original.id, label: originalLabel },
      { text: draft.text, label: draftLabel },
    ],
    framework: original.framework.slug,
    version: original.framework.version,
    ...(original.context ? { context: original.context } : {}),
    ...(original.projectId ? { projectId: original.projectId } : {}),
    ...(original.judges.length > 0 ? { judges: original.judges } : { profile: 'quick' }),
  };
}
