/**
 * Turning a report's print page into a PDF with headless Chromium (t-31).
 *
 * The PDF is the web report's `print` variant, printed by a browser, so it is
 * the same layout as the page and its print stylesheet, not a second design.
 * Each render launches its own browser and closes it afterwards. Renders are
 * rare, because the route caches the file, and a browser that lives only as
 * long as one render cannot carry one report's state into the next.
 *
 * **What the browser may reach.** It opens one page, this app's print route
 * for one assessment, on loopback ({@link renderOrigin}): the server's own
 * port on 127.0.0.1, so the request and its token stay on the machine rather
 * than going out through a CDN or load balancer and back. The render token
 * goes in a header (`RENDER_TOKEN_HEADER`), not in the URL, so it is not
 * written to access logs or sent on as a referrer. Every request to any other
 * origin is aborted, so the token cannot be sent off the server and the
 * page's analytics never fire for a render.
 *
 * **Bounded in time and in number.** At most {@link MAX_CONCURRENT_RENDERS}
 * browsers run at once, and at most {@link MAX_QUEUED_RENDERS} renders wait;
 * beyond that a render is refused as `busy`. Each render, from launch to the
 * last byte, has one deadline, {@link RENDER_TIMEOUT_MS}, after which its
 * browser is closed. The token is minted when the render gets its slot, not
 * when it starts waiting, so time in the queue cannot expire it.
 *
 * **The sandbox is off** (`--no-sandbox`). Chromium's sandbox needs user
 * namespaces or root, and the Docker image runs as an unprivileged user
 * without either, which is the usual reason headless Chromium in a container
 * runs unsandboxed. The browser renders only this app's own page: the copy is
 * shown as text, the report renders no raw HTML, and requests anywhere else
 * are aborted. That is what makes running it unsandboxed acceptable here, and
 * it is what a change that lets the print page load outside content has to
 * reconsider.
 */
import puppeteer, { type Browser } from 'puppeteer-core';
import { env } from '@/lib/env';
import { getBaseUrl } from '@/lib/api/server-fetch';
import { logger } from '@/lib/logging';
import { BRAND } from '@/lib/brand';
import { escapeHtml } from '@/lib/security/sanitize';
import { WORDS } from '@/lib/app/reports/words';
import { RENDER_TOKEN_HEADER } from '@/lib/app/reports/pdf/render-token';

/** The attribute the print page sets once the report itself has rendered. */
export const PDF_READY_ATTRIBUTE = 'data-pdf-ready';

/**
 * The attribute the print page sets when the stored result cannot be read.
 * Rendering again will not change that, so it is its own refusal.
 */
export const PDF_UNREADABLE_ATTRIBUTE = 'data-pdf-unreadable';

/** How long a render may take, launch to last byte, before its browser is closed. */
export const RENDER_TIMEOUT_MS = 30_000;

/** Renders one process runs at once. Each is a whole browser, so few. */
export const MAX_CONCURRENT_RENDERS = 2;

/** Renders that may wait for a slot. More are refused as `busy`. */
export const MAX_QUEUED_RENDERS = 8;

/**
 * How long a render may wait for a slot before it is refused as `busy`. With
 * {@link RENDER_TIMEOUT_MS} it stays inside the route's 60 s `maxDuration`.
 */
export const MAX_QUEUE_WAIT_MS = 20_000;

/**
 * Where Chromium is when `PDF_CHROMIUM_PATH` is unset: the Docker image's
 * (`apk add chromium`, which the Dockerfile also names in `PDF_CHROMIUM_PATH`)
 * on Linux, and Google Chrome's usual install on a Mac, for development.
 */
const DEFAULT_CHROMIUM: Partial<Record<NodeJS.Platform, string>> = {
  linux: '/usr/bin/chromium-browser',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
};

export class PdfRenderError extends Error {
  constructor(
    readonly reason: 'no-browser' | 'not-rendered' | 'unreadable' | 'busy' | 'timeout' | 'failed',
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'PdfRenderError';
  }
}

/** The Chromium binary to launch: `PDF_CHROMIUM_PATH`, else this platform's default. */
export function chromiumPath(platform: NodeJS.Platform = process.platform): string {
  const path = env.PDF_CHROMIUM_PATH ?? DEFAULT_CHROMIUM[platform];
  if (!path) {
    throw new PdfRenderError(
      'no-browser',
      `No Chromium to render PDFs with on ${platform}. Set PDF_CHROMIUM_PATH.`
    );
  }
  return path;
}

/**
 * Where the browser reaches this app, in this order:
 *
 * 1. `INTERNAL_API_URL`, when set: the operator's explicit answer, as it is
 *    for every self-call (`getBaseUrl`), for a server that does not listen on
 *    loopback (a pod bound to its own IP, a sidecar).
 * 2. Loopback on the server's own `PORT` (set by the Docker image and by
 *    `npm run dev`). It keeps the render's request, and its token, on the
 *    machine, and is not subject to a CDN's redirect to a canonical host.
 *    Chrome exempts loopback from the production CSP's
 *    `upgrade-insecure-requests`, so the page's assets stay on this origin
 *    (checked for t-31).
 * 3. {@link getBaseUrl}'s answer otherwise.
 */
export function renderOrigin(): string {
  const explicit = env.INTERNAL_API_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const port = process.env.PORT;
  return port && /^\d{1,5}$/.test(port) ? `http://127.0.0.1:${port}` : getBaseUrl();
}

/** The print page's address for an assessment. */
export function printPageUrl(assessmentId: string): string {
  return `${renderOrigin()}/print/assessments/${encodeURIComponent(assessmentId)}`;
}

// --- At most MAX_CONCURRENT_RENDERS at once --------------------------------

/**
 * A counting semaphore with a bounded queue: `run(fn)` runs `fn` holding one
 * of `max` slots, waits in line when they are all taken, and is refused as
 * `busy` when `queueMax` are already waiting or no slot comes within
 * `waitMs`.
 *
 * A slot that comes free goes straight to the longest waiter (the count of
 * slots in use stays as it is), so a caller arriving at that moment cannot
 * take it as well and push past `max`.
 */
export function createRenderSlots(
  max: number,
  queueMax: number,
  waitMs: number = MAX_QUEUE_WAIT_MS
): <T>(fn: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  const busy = () => new PdfRenderError('busy', 'Too many PDFs are being made. Try again shortly.');

  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (running >= max) {
      if (waiting.length >= queueMax) throw busy();
      // Woken holding the slot its releaser handed over, or refused once the
      // wait runs out, leaving the line so no slot is handed to it after.
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          waiting.splice(waiting.indexOf(wake), 1);
          reject(busy());
        }, waitMs);
        waiting.push(wake);
      });
    } else {
      running += 1;
    }
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running -= 1;
    }
  };
}

const withRenderSlot = createRenderSlots(MAX_CONCURRENT_RENDERS, MAX_QUEUED_RENDERS);

/** The footer on every page: the report's name and its page number. */
function footerTemplate(): string {
  return (
    '<div style="width:100%;padding:0 16mm;font:8px/1 ui-monospace,monospace;color:#5a5955;' +
    'display:flex;justify-content:space-between">' +
    `<span>${escapeHtml(`${BRAND.name} · ${WORDS.Review}`)}</span>` +
    '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'
  );
}

/**
 * Render assessment `assessmentId`'s print page to PDF bytes. `mintToken` is
 * called once the render has its slot, so the token's short life starts when
 * the browser is about to use it. Throws {@link PdfRenderError}.
 */
export async function renderReportPdf(
  assessmentId: string,
  mintToken: () => string
): Promise<Buffer> {
  const url = printPageUrl(assessmentId);
  const origin = new URL(url).origin;

  return withRenderSlot(async () => {
    const started = Date.now();
    const token = mintToken();
    let browser: Browser | undefined;
    let timedOut = false;
    // One deadline for the whole render: closing the browser makes whatever
    // step is waiting on it fail at once.
    const deadline = setTimeout(() => {
      timedOut = true;
      void browser?.close().catch(() => undefined);
    }, RENDER_TIMEOUT_MS);
    try {
      browser = await puppeteer.launch({
        executablePath: chromiumPath(),
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--font-render-hinting=none',
        ],
        timeout: RENDER_TIMEOUT_MS,
      });
      if (timedOut) throw new PdfRenderError('timeout', 'The PDF took too long to make');
      const page = await browser.newPage();
      page.setDefaultTimeout(RENDER_TIMEOUT_MS);

      await page.setRequestInterception(true);
      page.on('request', (request) => {
        // The page's own inline data (`data:` fonts and images, `blob:`) has no
        // origin to compare and goes nowhere, so it is allowed.
        const inline = /^(data|blob):/.test(request.url());
        if (!inline && safeOrigin(request.url()) !== origin) {
          void request.abort('blockedbyclient');
          return;
        }
        // The token rides only on the document request; the page's own
        // scripts, styles and fonts need nothing.
        const isDocument = request.isNavigationRequest() && request.frame() === page.mainFrame();
        void request.continue(
          isDocument
            ? { headers: { ...request.headers(), [RENDER_TOKEN_HEADER]: token } }
            : undefined
        );
      });

      const response = await page.goto(url, { waitUntil: 'networkidle0' });
      if (!response?.ok()) {
        throw new PdfRenderError(
          'not-rendered',
          `The print page answered ${response?.status() ?? 'nothing'}`
        );
      }
      if (await page.$(`[${PDF_UNREADABLE_ATTRIBUTE}]`)) {
        throw new PdfRenderError('unreadable', "The review's stored result cannot be read");
      }
      if (!(await page.$(`[${PDF_READY_ATTRIBUTE}]`))) {
        throw new PdfRenderError('not-rendered', 'The print page did not render a report');
      }
      // Fonts load after `networkidle0` can settle on some pages.
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: footerTemplate(),
      });
      logger.info('Report PDF rendered', {
        assessmentId,
        ms: Date.now() - started,
        bytes: pdf.byteLength,
      });
      return Buffer.from(pdf);
    } catch (err) {
      if (timedOut) {
        throw new PdfRenderError('timeout', 'The PDF took too long to make', { cause: err });
      }
      if (err instanceof PdfRenderError) throw err;
      throw new PdfRenderError('failed', 'The PDF could not be rendered', { cause: err });
    } finally {
      clearTimeout(deadline);
      await browser?.close().catch((err: unknown) => {
        if (!timedOut) {
          logger.warn('Report PDF: the browser did not close cleanly', { assessmentId, err });
        }
      });
    }
  });
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
