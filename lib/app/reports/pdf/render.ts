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
 * for one assessment, over {@link getBaseUrl} (loopback in development,
 * `INTERNAL_API_URL` or the app URL otherwise). The render token goes in a
 * header (`RENDER_TOKEN_HEADER`), not in the URL, so it is not written to
 * access logs or sent on as a referrer. Every request to any other origin is
 * aborted, so the token cannot be sent off the server and the page's
 * analytics never fire for a render.
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

/** How long a render may take, end to end, before it is given up. */
export const RENDER_TIMEOUT_MS = 30_000;

/** Renders one process runs at once. Each is a whole browser, so few. */
export const MAX_CONCURRENT_RENDERS = 2;

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
    readonly reason: 'no-browser' | 'not-rendered' | 'failed',
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

/** The print page's address for an assessment. */
export function printPageUrl(assessmentId: string): string {
  return `${getBaseUrl()}/print/assessments/${encodeURIComponent(assessmentId)}`;
}

// --- At most MAX_CONCURRENT_RENDERS at once --------------------------------

let running = 0;
const waiting: (() => void)[] = [];

async function withRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT_RENDERS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running += 1;
  try {
    return await fn();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

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
 * Render assessment `assessmentId`'s print page to PDF bytes, authorised by
 * `token`. Throws {@link PdfRenderError}.
 */
export async function renderReportPdf(assessmentId: string, token: string): Promise<Buffer> {
  const url = printPageUrl(assessmentId);
  const origin = new URL(url).origin;

  return withRenderSlot(async () => {
    const started = Date.now();
    let browser: Browser | undefined;
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
      const page = await browser.newPage();
      page.setDefaultTimeout(RENDER_TIMEOUT_MS);

      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const sameOrigin = safeOrigin(request.url()) === origin;
        if (!sameOrigin) {
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
      const ready = await page.$(`[${PDF_READY_ATTRIBUTE}]`);
      if (!ready) {
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
      if (err instanceof PdfRenderError) throw err;
      throw new PdfRenderError('failed', 'The PDF could not be rendered', { cause: err });
    } finally {
      await browser?.close().catch((err: unknown) => {
        logger.warn('Report PDF: the browser did not close cleanly', { assessmentId, err });
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
