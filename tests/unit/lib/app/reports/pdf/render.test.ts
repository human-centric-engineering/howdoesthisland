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
    closeError: null as Error | null,
    unreadable: false,
    /** Hold `launch` until released, to keep a render in its slot. */
    launchGate: null as Promise<void> | null,
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
    $: vi.fn(async (selector: string) =>
      selector === '[data-pdf-unreadable]'
        ? state.unreadable
          ? {}
          : null
        : state.ready
          ? {}
          : null
    ),
    // Runs the callback, as the page would, against the stubbed `document`.
    evaluate: vi.fn(async (fn: () => unknown) => fn()),
    pdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
  };
  const launch = vi.fn(async (options: unknown) => {
    state.launches.push(options);
    if (state.launchGate) await state.launchGate;
    return {
      newPage: async () => page,
      close: async () => {
        state.closed += 1;
        if (state.closeError) throw state.closeError;
      },
    };
  });
  return { state, page, launch, mainFrame };
});
vi.mock('puppeteer-core', () => ({ default: { launch: b.launch } }));

import {
  chromiumPath,
  createRenderSlots,
  MAX_QUEUED_RENDERS,
  PdfRenderError,
  printPageUrl,
  RENDER_TIMEOUT_MS,
  renderOrigin,
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
    closeError: null,
    unreadable: false,
    launchGate: null,
  });
  vi.stubEnv('PORT', '');
  // `clearAllMocks` keeps implementations: put back the ones a test may replace.
  b.page.pdf.mockImplementation(async () => new Uint8Array([37, 80, 68, 70]));
  mockEnv.PDF_CHROMIUM_PATH = undefined;
  vi.stubGlobal('document', { fonts: { ready: Promise.resolve() } });
});

describe('renderOrigin', () => {
  it("is loopback on the server's own port when it is known", () => {
    vi.stubEnv('PORT', '3000');
    expect(renderOrigin()).toBe('http://127.0.0.1:3000');
  });

  it('falls back to the internal API URL when the port is not', () => {
    vi.stubEnv('PORT', 'not-a-port');
    expect(renderOrigin()).toBe('http://127.0.0.1:3000');
    mockEnv.INTERNAL_API_URL = 'http://web.internal:8080';
    expect(renderOrigin()).toBe('http://web.internal:8080');
    mockEnv.INTERNAL_API_URL = 'http://127.0.0.1:3000';
  });
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
    const pdf = await renderReportPdf('asm 1', () => 'tok');
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

    await renderReportPdf('asm_1', () => 'tok');
    expect(b.page.setRequestInterception).toHaveBeenCalledWith(true);
  });

  it('waits for the page’s fonts before printing', async () => {
    let fontsReady!: () => void;
    vi.stubGlobal('document', {
      fonts: { ready: new Promise<void>((resolve) => (fontsReady = resolve)) },
    });
    const render = renderReportPdf('asm_1', () => 'tok');
    await vi.waitFor(() => expect(b.page.evaluate).toHaveBeenCalled());
    expect(b.page.pdf).not.toHaveBeenCalled();
    fontsReady();
    await render;
    expect(b.page.pdf).toHaveBeenCalled();
  });

  it('still returns the PDF when the browser does not close cleanly', async () => {
    b.state.closeError = new Error('already gone');
    const pdf = await renderReportPdf('asm_1', () => 'tok');
    expect(pdf.toString()).toBe('%PDF');
  });

  it('launches with the configured binary and without the sandbox', async () => {
    mockEnv.PDF_CHROMIUM_PATH = '/usr/bin/chromium-browser';
    await renderReportPdf('asm_1', () => 'tok');
    expect(b.state.launches[0]).toMatchObject({
      executablePath: '/usr/bin/chromium-browser',
      headless: true,
      args: expect.arrayContaining(['--no-sandbox', '--disable-dev-shm-usage']),
    });
  });

  it('refuses a page that answered an error, closing the browser', async () => {
    b.state.status = 404;
    await expect(renderReportPdf('asm_1', () => 'tok')).rejects.toMatchObject({
      reason: 'not-rendered',
      message: 'The print page answered 404',
    });
    expect(b.page.pdf).not.toHaveBeenCalled();
    expect(b.state.closed).toBe(1);
  });

  it('refuses a page without the ready marker', async () => {
    b.state.ready = false;
    await expect(renderReportPdf('asm_1', () => 'tok')).rejects.toMatchObject({
      reason: 'not-rendered',
    });
    expect(b.page.pdf).not.toHaveBeenCalled();
  });

  it('refuses an unreadable report as such, not as a failure worth retrying', async () => {
    b.state.ready = false;
    b.state.unreadable = true;
    await expect(renderReportPdf('asm_1', () => 'tok')).rejects.toMatchObject({
      reason: 'unreadable',
    });
    expect(b.page.pdf).not.toHaveBeenCalled();
  });

  it('wraps any other failure, keeping the cause, and still closes the browser', async () => {
    const boom = new Error('Navigation timeout');
    b.state.gotoError = boom;
    const err = await renderReportPdf('asm_1', () => 'tok').catch((e: unknown) => e);
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
    const all = Promise.all([1, 2, 3].map((n) => renderReportPdf(`asm_${n}`, () => 'tok')));

    await vi.waitFor(() => expect(gates).toHaveLength(2));
    expect(b.launch).toHaveBeenCalledTimes(2);
    gates[0]?.();
    await vi.waitFor(() => expect(gates).toHaveLength(3));
    gates[1]?.();
    gates[2]?.();
    await all;
    expect(b.launch).toHaveBeenCalledTimes(3);
  });

  it('mints the token only once the render has a slot', async () => {
    let release!: () => void;
    b.state.launchGate = new Promise<void>((r) => (release = r));
    const mints: string[] = [];
    const mint = (n: number) => () => {
      mints.push(`asm_${n}`);
      return 'tok';
    };
    const all = Promise.all([1, 2, 3].map((n) => renderReportPdf(`asm_${n}`, mint(n))));

    await vi.waitFor(() => expect(b.launch).toHaveBeenCalledTimes(2));
    // The third is queued, and has no token yet.
    expect(mints).toEqual(['asm_1', 'asm_2']);
    release();
    await all;
    expect(mints).toEqual(['asm_1', 'asm_2', 'asm_3']);
  });

  it('refuses as busy once the queue is full', async () => {
    let release!: () => void;
    b.state.launchGate = new Promise<void>((r) => (release = r));
    const accepted = Array.from({ length: 2 + MAX_QUEUED_RENDERS }, (_, n) =>
      renderReportPdf(`asm_${n}`, () => 'tok')
    );
    await vi.waitFor(() => expect(b.launch).toHaveBeenCalledTimes(2));
    await expect(renderReportPdf('asm_over', () => 'tok')).rejects.toMatchObject({
      reason: 'busy',
    });
    release();
    await Promise.all(accepted);
  });

  it('gives up at the deadline, closing the browser, whatever step it is on', async () => {
    vi.useFakeTimers();
    try {
      // A page that never finishes loading, until its browser is closed.
      b.page.goto.mockImplementationOnce(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('closed')), 10 ** 9))
      );
      const render = renderReportPdf('asm_1', () => 'tok').catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(RENDER_TIMEOUT_MS);
      expect(b.state.closed).toBe(1);
      // The browser closing is what fails the stuck step.
      await vi.advanceTimersByTimeAsync(10 ** 9);
      expect(await render).toMatchObject({ reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createRenderSlots', () => {
  it('hands a freed slot to the waiter, so a newcomer at that moment waits its turn', async () => {
    const run = createRenderSlots(1, 5);
    let live = 0;
    let peak = 0;
    const job = async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live -= 1;
    };

    let finishFirst!: () => void;
    live = 1;
    peak = 1;
    // The exact promise the first job returns: the slot's release waits on it.
    const firstDone = new Promise<void>((r) => (finishFirst = r)).then(() => {
      live -= 1;
    });
    const first = run(() => firstDone);
    const waiter = run(job);
    // Arrives in the same turn the first slot frees: its callback is queued
    // behind the slot's release, and ahead of the waiter waking.
    const newcomer = firstDone.then(() => run(job));

    finishFirst();
    await Promise.all([first, waiter, newcomer]);
    expect(peak).toBe(1);
  });

  it('runs up to max at once and the rest in order', async () => {
    const run = createRenderSlots(2, 5);
    const order: number[] = [];
    const gates: (() => void)[] = [];
    const jobs = [1, 2, 3, 4].map((n) =>
      run(async () => {
        order.push(n);
        await new Promise<void>((r) => gates.push(r));
      })
    );
    await vi.waitFor(() => expect(order).toEqual([1, 2]));
    gates[0]?.();
    await vi.waitFor(() => expect(order).toEqual([1, 2, 3]));
    gates[1]?.();
    await vi.waitFor(() => expect(order).toEqual([1, 2, 3, 4]));
    gates[2]?.();
    gates[3]?.();
    await Promise.all(jobs);
  });

  it('frees its slot when the job throws', async () => {
    const run = createRenderSlots(1, 5);
    await expect(run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(run(async () => 'next')).resolves.toBe('next');
  });
});
