/**
 * Fetch a web page by URL and turn it into the text an assessment reads (t-16).
 *
 * The URL is chosen by whoever calls the API, anonymous free scans included,
 * so this is an SSRF surface and treats every URL as hostile:
 *
 * - **http(s) only, public addresses only, on every hop.** Each URL — the
 *   first and every redirect target — is checked as text by
 *   `checkSafeProviderUrl()`. That is what refuses an IP literal: `net.connect`
 *   never calls `lookup` for one, so the dispatcher below cannot see it.
 * - **Every connection is pinned to an address that was checked**, through
 *   `createSafeDispatcher()`, whoever is asking. Not `outboundDispatcher()`:
 *   that pins only for a customer org at `multi`, and the free scan runs as
 *   the install org, where it would fetch unpinned. Checking at connect time
 *   also closes DNS rebinding: the address connected to is the one checked.
 * - **Redirects are followed by hand**, at most {@link MAX_REDIRECTS}, so each
 *   hop gets both checks above.
 * - **The body is streamed under a byte cap**, and reading stops at the cap
 *   rather than after buffering the whole thing. One timeout covers all hops
 *   and the body.
 *
 * Core's `fetchDocumentFromUrl()` was not reused: it takes the file type from
 * the URL's extension first (refusing `/pricing.php` served as HTML), buffers
 * the whole body before its second size check, and pins only where
 * `outboundDispatcher()` does.
 *
 * The type comes from the response's `Content-Type`. HTML is reduced to its
 * main content (`mainContent()`) and that text goes to `extractText()`; every
 * other type goes to `extractText()` as the file it is. So every limit and
 * refusal `extractText()` applies to an upload applies to a page too.
 */

import type { Agent } from 'undici';
import {
  extractText,
  DEFAULT_INTAKE_LIMITS,
  type ExtractedText,
  type IntakeLimits,
} from '@/lib/app/intake/extract-text';
import { IntakeError, IntakeErrorCodes, unreadableFile } from '@/lib/app/intake/errors';
import { charsetOf, mainContent, type MainContent } from '@/lib/app/intake/main-content';
import { logger } from '@/lib/logging';
import { loggableUrl } from '@/lib/logging/redact-path';
import { createSafeDispatcher, isUnsafeAddressRefusal } from '@/lib/security/safe-dispatcher';
import { checkSafeProviderUrl } from '@/lib/security/safe-url';

/** One budget for every hop and the body. */
export const FETCH_TIMEOUT_MS = 15_000;

/** Redirects followed before giving up. */
export const MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** What a response's media type is read as, and the extension `extractText()` reads it by. */
const TYPES: Record<string, { ext: string; html?: true; text?: true }> = {
  'text/html': { ext: '.html', html: true },
  'application/xhtml+xml': { ext: '.html', html: true },
  'application/pdf': { ext: '.pdf' },
  'text/plain': { ext: '.txt', text: true },
  'text/markdown': { ext: '.md', text: true },
  'text/x-markdown': { ext: '.md', text: true },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: '.docx' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: '.pptx' },
};

const REQUEST_HEADERS = {
  'User-Agent': 'HowDoesThisLand/1.0 (content assessment)',
  Accept: `${Object.keys(TYPES).join(', ')}, */*;q=0.1`,
};

export interface FetchPageOptions {
  /** Overrides for the intake limits; `maxBytes` also caps the download. */
  limits?: Partial<IntakeLimits>;
  /** Overrides {@link FETCH_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Tests only: the dispatcher every hop connects through, so a test can
   * answer DNS and reach a local server. Production callers pass nothing and
   * get the safe dispatcher.
   */
  dispatcher?: Agent;
}

export interface FetchedPage extends ExtractedText {
  /** The URL the content came from, after redirects. */
  url: string;
}

/** One process-wide pinned `Agent`: it holds no caller's data, and checks every new socket. */
let safeDispatcher: Agent | null = null;

/**
 * The text of the page at `url`, with its word count, title and warnings.
 *
 * @throws IntakeError for every refusal; the code says which
 */
export async function fetchPage(url: string, options: FetchPageOptions = {}): Promise<FetchedPage> {
  const limits: IntakeLimits = { ...DEFAULT_INTAKE_LIMITS, ...options.limits };
  const signal = AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS);
  const dispatcher = options.dispatcher ?? (safeDispatcher ??= createSafeDispatcher());

  // The hop being fetched, so a failure is logged against the URL that failed.
  const at = { url };
  try {
    const fetched = await fetchFollowingRedirects(url, dispatcher, signal, at);
    return await readPage(fetched.response, fetched.url, limits, signal);
  } catch (err) {
    if (err instanceof IntakeError) throw err;
    if (signal.aborted) {
      logger.warn('Intake page fetch timed out', { url: loggableUrl(at.url) });
      throw new IntakeError(
        IntakeErrorCodes.FETCH_TIMEOUT,
        `That page took longer than ${duration(options.timeoutMs ?? FETCH_TIMEOUT_MS)} to load.`
      );
    }
    // A name that resolves inside the network reads the same as a name that
    // does not resolve, so the answer cannot be used to map the network. The
    // log keeps which it was.
    logger.warn('Intake page fetch failed', {
      url: loggableUrl(at.url),
      reason: isUnsafeAddressRefusal(err) ? 'unsafe-address' : 'network',
      error: err instanceof Error ? err.message : String(err),
    });
    throw new IntakeError(IntakeErrorCodes.FETCH_FAILED, "We couldn't reach that page.");
  }
}

/** Refuses a URL that is not http(s), or whose host is not a public address as written. */
function assertFetchable(url: string, hop: number): void {
  const check = checkSafeProviderUrl(url);
  if (check.ok) return;
  const problem =
    check.reason === 'invalid_url'
      ? 'not a valid web address'
      : check.reason === 'disallowed_scheme'
        ? 'not an http or https address'
        : 'not a public web address';
  const message =
    hop > 0 ? `That page redirects to an address that is ${problem}.` : `That is ${problem}.`;
  logger.warn('Intake refused a URL', { url: loggableUrl(url), hop, reason: check.reason });
  throw new IntakeError(IntakeErrorCodes.URL_NOT_ALLOWED, message, { reason: check.reason });
}

async function fetchFollowingRedirects(
  url: string,
  dispatcher: Agent,
  signal: AbortSignal,
  at: { url: string }
): Promise<{ response: Response; url: string }> {
  let current = url;
  for (let hop = 0; ; hop++) {
    at.url = current;
    assertFetchable(current, hop);

    const response = await fetch(
      current,
      withDispatcher({ redirect: 'manual', signal, headers: REQUEST_HEADERS }, dispatcher)
    );

    if (!REDIRECT_STATUSES.has(response.status)) return { response, url: current };

    // Release the socket: an unread body holds it out of the pool.
    await discard(response.body);
    const location = response.headers.get('location');
    if (!location) {
      logger.warn('Intake page fetch: redirect without Location', {
        url: loggableUrl(current),
        status: response.status,
      });
      throw new IntakeError(
        IntakeErrorCodes.FETCH_FAILED,
        'That page redirects without saying where to.',
        { status: response.status }
      );
    }
    if (hop >= MAX_REDIRECTS) {
      logger.warn('Intake page fetch: too many redirects', {
        url: loggableUrl(url),
        last: loggableUrl(current),
      });
      throw new IntakeError(
        IntakeErrorCodes.FETCH_FAILED,
        `That page redirects more than ${MAX_REDIRECTS} times.`
      );
    }
    try {
      current = new URL(location, current).toString();
    } catch {
      throw new IntakeError(
        IntakeErrorCodes.URL_NOT_ALLOWED,
        'That page redirects to an address that is not valid.'
      );
    }
  }
}

async function readPage(
  response: Response,
  url: string,
  limits: IntakeLimits,
  signal: AbortSignal
): Promise<FetchedPage> {
  if (!response.ok) {
    await discard(response.body);
    logger.warn('Intake page fetch: not 2xx', { url: loggableUrl(url), status: response.status });
    throw new IntakeError(
      IntakeErrorCodes.FETCH_FAILED,
      `That page answered with an error (HTTP ${response.status}).`,
      { status: response.status }
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  // Own keys only: `constructor` is not a media type.
  const type = Object.hasOwn(TYPES, mediaType) ? TYPES[mediaType] : undefined;
  if (!type) {
    await discard(response.body);
    throw new IntakeError(
      IntakeErrorCodes.UNSUPPORTED_TYPE,
      `We can't read ${mediaType ? `${mediaType} content` : 'a page that does not say what it is'}. Link to a web page, PDF, Word document, PowerPoint deck, Markdown or plain text file.`,
      { contentType: mediaType || null }
    );
  }

  const declared = Number(response.headers.get('content-length'));
  if (declared > limits.maxBytes) {
    await discard(response.body);
    throw tooLarge(limits.maxBytes);
  }
  const bytes = await readCapped(response.body, limits.maxBytes, signal);

  if (type.html) {
    let page: MainContent;
    try {
      page = mainContent(bytes, contentType);
    } catch (err) {
      // A parse failure is not a network failure; say which it was.
      throw unreadableFile('a web page', err);
    }
    // The main content is already text: read as text so `extractText()`
    // applies its limits without re-parsing it as HTML.
    const read = await extractText(Buffer.from(page.text, 'utf8'), 'page.txt', limits);
    return { ...read, title: page.title || hostOf(url), format: 'html', url };
  }

  const body = type.text ? asUtf8(bytes, contentType) : bytes;
  const read = await extractText(body, `${nameFrom(url)}${type.ext}`, limits);
  return { ...read, url };
}

/**
 * `init` with undici's `dispatcher` option, which Node's `fetch` honours and
 * `RequestInit` does not declare.
 */
function withDispatcher<T extends RequestInit>(
  init: T,
  dispatcher: Agent
): T & { dispatcher: Agent } {
  return { ...init, dispatcher };
}

/** Cancel a body we will not read. One that already ended or errored has nothing to release. */
async function discard(body: { cancel(): Promise<void> } | null | undefined): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // Already closed.
  }
}

/**
 * A text body re-encoded as UTF-8, which is how `extractText()` reads it. The
 * response's charset decides how it is decoded; an unknown or absent one
 * leaves the bytes as they are.
 */
function asUtf8(bytes: Buffer, contentType: string): Buffer {
  const charset = charsetOf(contentType);
  if (!charset || /^utf-?8$/i.test(charset)) return bytes;
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    return bytes;
  }
  return Buffer.from(decoder.decode(bytes), 'utf8');
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function tooLarge(maxBytes: number): IntakeError {
  const size =
    maxBytes >= 1_048_576
      ? `${Math.round(maxBytes / 1_048_576)} MB`
      : `${Math.max(1, Math.round(maxBytes / 1024))} KB`;
  return new IntakeError(
    IntakeErrorCodes.TOO_LARGE,
    `That page is larger than ${size}, the largest we read.`,
    { maxBytes }
  );
}

/**
 * The body, read until it ends or passes `maxBytes`. Past the cap the stream
 * is cancelled at once, so the rest is never downloaded. A timeout cancels the
 * read too, whatever the stream does with the signal itself.
 */
async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal: AbortSignal
): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const onAbort = (): void => void discard(reader);
  signal.addEventListener('abort', onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await discard(reader);
        throw tooLarge(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  return Buffer.concat(chunks);
}

function hostOf(url: string): string {
  return new URL(url).hostname;
}

/** A file name for a non-HTML response: the URL's last path segment, else its host. */
function nameFrom(url: string): string {
  const parsed = new URL(url);
  let segment = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    segment = decodeURIComponent(segment);
  } catch {
    // Keep it encoded.
  }
  // Its extension is the server's naming, not the type: `/report.php` served as a PDF.
  const name = segment.replace(/[\\/]/g, '-').replace(/\.[^.]*$/, '');
  return name || parsed.hostname;
}
