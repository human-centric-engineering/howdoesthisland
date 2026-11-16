/**
 * Tests: rendering the print page with headless Chromium (t-31).
 *
 * Puppeteer is replaced by a fake browser that records what the renderer
 * asks of it, and lets a test drive the page's request handler with requests
 * of its choosing. What it pins: where the token goes (the document request
 * on this app's origin, and nowhere else), what is aborted (every other
 * origin), the browser always closing, and a page that did not render a
 * report never becoming a PDF. A real render was checked on the dev server
 * and in the Docker image (PR description).
 *
 * @see lib/app/reports/pdf/render.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  BETTER_AUTH_URL: 'https://app.example.com',
  INTERNAL_API_URL: 'http://127.0.0.1:3000',
  PDF_CHROMIUM_PATH: undefined as string | undefined,
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface FakeRequest {
  url: () => string;
  isNavigationRequest: () => boolean;
  frame: () => unknown;
  headers: () => Record<string, string>;
  abort: ReturnType<typeof vi.fn>;
  continue: ReturnType<typeof vi.fn>;
}

const b = vi.hoisted(() => {
  const mainFrame = {};
  const state = {
    onRequest: null as ((r: unknown) => void) | null,
    status: 200,
    ready: true,
    gotoError: null as Error | null,
    launches: [] as unknown[],
    closed: 0,
    gotoUrl: '',
  };
  const page = {
    setDefaultTimeout: vi.fn(),
    setRequestInterception: vi.fn(async () => undefined),
    on: vi.fn((event: string, fn: (r: unknown) => void) => {
      if (event === 'request') state.onRequest = fn;
    }),
    mainFrame: () => mainFrame,
    goto: vi.fn(async (url: string) => {
      state.gotoUrl = url;
      if (state.gotoError) throw state.gotoError;
      return { ok: () => state.status >= 200 && state.status < 300, status: () => state.status };
    }),
    $: vi.fn(async () => (state.ready ? {} : null)),
    evaluate: vi.fn(async () => undefined),
    pdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
  };
  const launch = vi.fn(async (options: unknown) => {
    state.launches.push(options);
    return {
      newPage: async () => page,
      close: async () => {
        state.closed += 1;
      },
    };
  });
  return { state, page, launch, mainFrame };
});
vi.mock('puppeteer-core', () => ({ default: { launch: b.launch } }));

import {
  chromiumPath,
  PdfRenderError,
  printPageUrl,
  renderReportPdf,
} from '@/lib/app/reports/pdf/render';

function request(url: string, opts: { document?: boolean; frame?: unknown } = {}): FakeRequest {
  return {
    url: () => url,
    isNavigationRequest: () => opts.document ?? false,
    frame: () => opts.frame ?? b.mainFrame,
    headers: () => ({ accept: '*/*' }),
    abort: vi.fn(async () => undefined),
    continue: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(b.state, {
    onRequest: null,
    status: 200,
    ready: true,
    gotoError: null,
    launches: [],
    closed: 0,
    gotoUrl: '',
  });
  mockEnv.PDF_CHROMIUM_PATH = undefined;
});

describe('chromiumPath', () => {
  it('uses PDF_CHROMIUM_PATH when set', () => {
    mockEnv.PDF_CHROMIUM_PATH = '/opt/chrome';
    expect(chromiumPath('linux')).toBe('/opt/chrome');
  });

  it("falls back to the platform's usual install", () => {
    expect(chromiumPath('linux')).toBe('/usr/bin/chromium-browser');
    expect(chromiumPath('darwin')).toMatch(/Google Chrome$/);
  });

  it('refuses a platform with no default, saying what to set', () => {
    expect(() => chromiumPath('win32')).toThrow(/PDF_CHROMIUM_PATH/);
  });
});

describe('renderReportPdf', () => {
  it("opens this app's print page for the review and returns the PDF", async () => {
    const pdf = await renderReportPdf('asm 1', 'tok');
    expect(b.state.gotoUrl).toBe(printPageUrl('asm 1'));
    expect(printPageUrl('asm 1')).toBe('http://127.0.0.1:3000/print/assessments/asm%201');
    expect(pdf.toString()).toBe('%PDF');
    expect(b.page.pdf).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'A4', printBackground: true, preferCSSPageSize: true })
    );
    expect(b.state.closed).toBe(1);
  });

  it('sends the token only on the document request to this origin, and aborts every other origin', async () => {
    b.page.goto.mockImplementationOnce(async (url: string) => {
      const doc = request(url, { document: true });
      const css = request('http://127.0.0.1:3000/_next/static/app.css');
      const frameDoc = request('http://127.0.0.1:3000/embed', { document: true, frame: {} });
      const analytics = request('https://www.googletagmanager.com/gtag/js');
      const lookalike = request('http://127.0.0.1:3001/print/assessments/x', { document: true });
      const garbage = request('not a url');
      for (const r of [doc, css, frameDoc, analytics, lookalike, garbage]) b.state.onRequest?.(r);

      expect(doc.continue).toHaveBeenCalledWith({
        headers: { accept: '*/*', 'x-report-render-token': 'tok' },
      });
      expect(css.continue).toHaveBeenCalledWith(undefined);
      expect(frameDoc.continue).toHaveBeenCalledWith(undefined);
      for (const r of [analytics, lookalike, garbage]) {
        expect(r.abort).toHaveBeenCalledWith('blockedbyclient');
        expect(r.continue).not.toHaveBeenCalled();
      }
      return { ok: () => true, status: () => 200 };
    });

    await renderReportPdf('asm_1', 'tok');
    expect(b.page.setRequestInterception).toHaveBeenCalledWith(true);
  });

  it('launches with the configured binary and without the sandbox', async () => {
    mockEnv.PDF_CHROMIUM_PATH = '/usr/bin/chromium-browser';
    await renderReportPdf('asm_1', 'tok');
    expect(b.state.launches[0]).toMatchObject({
      executablePath: '/usr/bin/chromium-browser',
      headless: true,
      args: expect.arrayContaining(['--no-sandbox', '--disable-dev-shm-usage']),
    });
  });

  it('refuses a page that answered an error, closing the browser', async () => {
    b.state.status = 404;
    await expect(renderReportPdf('asm_1', 'tok')).rejects.toMatchObject({
      reason: 'not-rendered',
      message: 'The print page answered 404',
    });
    expect(b.page.pdf).not.toHaveBeenCalled();
    expect(b.state.closed).toBe(1);
  });

  it('refuses a page without the ready marker (an unreadable report)', async () => {
    b.state.ready = false;
    await expect(renderReportPdf('asm_1', 'tok')).rejects.toMatchObject({ reason: 'not-rendered' });
    expect(b.page.pdf).not.toHaveBeenCalled();
  });

  it('wraps any other failure, keeping the cause, and still closes the browser', async () => {
    const boom = new Error('Navigation timeout');
    b.state.gotoError = boom;
    const err = await renderReportPdf('asm_1', 'tok').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfRenderError);
    expect(err).toMatchObject({ reason: 'failed', cause: boom });
    expect(b.state.closed).toBe(1);
  });

  it('runs at most two renders at once, starting the next as one finishes', async () => {
    const gates: (() => void)[] = [];
    b.page.pdf.mockImplementation(
      () =>
        new Promise<Uint8Array<ArrayBuffer>>((resolve) =>
          gates.push(() => resolve(new Uint8Array([1])))
        )
    );
    const all = Promise.all([1, 2, 3].map((n) => renderReportPdf(`asm_${n}`, 'tok')));

    await vi.waitFor(() => expect(gates).toHaveLength(2));
    expect(b.launch).toHaveBeenCalledTimes(2);
    gates[0]?.();
    await vi.waitFor(() => expect(gates).toHaveLength(3));
    gates[1]?.();
    gates[2]?.();
    await all;
    expect(b.launch).toHaveBeenCalledTimes(3);
  });
});
