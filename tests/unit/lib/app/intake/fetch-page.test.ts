/**
 * fetchPage (t-16): a page fetched by URL, and every refusal by its code.
 *
 * The fetches are REAL: undici's `fetch`, through an undici `Agent`, to a
 * local server. Made-up hostnames are answered by a resolver, as in
 * `tests/unit/lib/security/safe-dispatcher.test.ts`, so redirects, the byte
 * cap and the timeout are exercised against a real socket rather than a mock
 * that would honour whatever the code asked of it.
 *
 * `tests/setup.ts` blocks the global `fetch`, so it is stubbed with the
 * `undici` package's own. That Node's built-in `fetch`, which production
 * calls, honours this package's `Agent` the same way is proven by the
 * subprocess test in `safe-dispatcher.test.ts`.
 *
 * Most tests pass a dispatcher that resolves `site.t16.test` to the local
 * server and allows loopback, because there is no other way to reach one.
 * The tests under "the safe dispatcher, by default" pass none: they go
 * through the dispatcher production uses, with `node:dns` answering, and
 * prove it refuses a name that resolves inside the network, as the install
 * org too.
 *
 * @see lib/app/intake/fetch-page.ts
 */

import { readFileSync } from 'fs';
import { createServer, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { join } from 'path';
import { fetch as undiciFetch } from 'undici';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({ TENANCY_MODE: 'multi' }));
vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get: (t, k) => (k === 'TENANCY_MODE' ? mockEnv.TENANCY_MODE : Reflect.get(t, k)),
    }),
  };
});
vi.mock('@/lib/logging', () => {
  const log = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...log, withContext: vi.fn(() => log) } };
});

/** What `node:dns` answers for the made-up names; anything else goes to real DNS. */
const dnsTable = vi.hoisted((): Record<string, { address: string; family: number }[]> => ({
  'intranet.t16.test': [{ address: '10.0.0.5', family: 4 }],
  'loopback.t16.test': [{ address: '127.0.0.1', family: 4 }],
}));
vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>();
  const lookup = ((hostname: string, options: unknown, callback: unknown) => {
    const found = dnsTable[hostname];
    if (found && typeof callback === 'function') return callback(null, found);
    return (actual.lookup as (...a: unknown[]) => void)(hostname, options, callback);
  }) as typeof actual.lookup;
  return { ...actual, default: { ...actual, lookup }, lookup };
});

import { fetchPage, MAX_REDIRECTS } from '@/lib/app/intake/fetch-page';
import { IntakeError, IntakeErrorCodes, type IntakeErrorCode } from '@/lib/app/intake/errors';
import { logger } from '@/lib/logging';
import {
  createSafeDispatcher,
  outboundDispatcher,
  type ResolveAll,
} from '@/lib/security/safe-dispatcher';
import { runAsOrg } from '@/lib/tenancy/context';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';

const FIXTURES = join(process.cwd(), 'tests/fixtures/app/intake');
const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, name));

const resolveTestNames: ResolveAll = (hostname, _options, callback) => {
  if (hostname === 'site.t16.test') return callback(null, [{ address: '127.0.0.1', family: 4 }]);
  if (hostname === 'intranet.t16.test') return callback(null, [{ address: '10.0.0.5', family: 4 }]);
  const err: NodeJS.ErrnoException = new Error(`ENOTFOUND ${hostname}`);
  err.code = 'ENOTFOUND';
  callback(err, []);
};
/** Reaches the local server under `site.t16.test`; still refuses `intranet.t16.test`. */
const testDispatcher = createSafeDispatcher({ allowLoopback: true }, resolveTestNames);

let server: Server;
let port: number;
let hits: string[] = [];
/** The oversize stream's state, read after it is cut off. */
const huge = { written: 0, finished: false, closed: Promise.resolve() };

function stream(res: ServerResponse): void {
  const chunk = Buffer.alloc(16 * 1024, 'a');
  const total = 50 * 1024 * 1024;
  huge.written = 0;
  huge.finished = false;
  huge.closed = new Promise((resolve) => res.on('close', () => resolve()));
  let open = true;
  res.on('close', () => (open = false));
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  const pump = (): void => {
    while (open && huge.written < total) {
      huge.written += chunk.length;
      if (!res.write(chunk)) return void res.once('drain', pump);
    }
    if (open) {
      huge.finished = true;
      res.end();
    }
  };
  pump();
}

beforeAll(async () => {
  vi.stubGlobal('fetch', undiciFetch);
  server = createServer((req, res) => {
    const path = req.url ?? '/';
    hits.push(path);
    const loop = /^\/loop\/(\d+)$/.exec(path);
    const hop = /^\/hop\/(\d+)$/.exec(path);
    if (path === '/register-to-vote') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fixture('gov-uk-register-to-vote.html'));
    } else if (path === '/download.php?id=3') {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.end(fixture('report.pdf'));
    } else if (path === '/notes') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(fixture('feedback.txt'));
    } else if (path === '/logo') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    } else if (path === '/notes-latin1') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=iso-8859-1' });
      res.end(Buffer.from('Café crème, £5', 'latin1'));
    } else if (path === '/nowhere-redirect') {
      res.writeHead(302);
      res.end();
    } else if (path === '/odd-type') {
      res.writeHead(200, { 'Content-Type': 'constructor' });
      res.end('not a type');
    } else if (path === '/untyped') {
      res.end('no content type at all');
    } else if (path === '/missing') {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<p>Not found</p>');
    } else if (loop) {
      res.writeHead(302, { Location: `/loop/${Number(loop[1]) + 1}` });
      res.end();
    } else if (hop) {
      const n = Number(hop[1]);
      res.writeHead(302, { Location: n < MAX_REDIRECTS ? `/hop/${n + 1}` : '/register-to-vote' });
      res.end();
    } else if (path === '/to-private') {
      res.writeHead(302, { Location: 'http://10.0.0.5/admin' });
      res.end();
    } else if (path === '/to-metadata') {
      res.writeHead(301, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    } else if (path === '/to-file') {
      res.writeHead(302, { Location: 'file:///etc/passwd' });
      res.end();
    } else if (path === '/to-intranet') {
      res.writeHead(302, { Location: 'http://intranet.t16.test/' });
      res.end();
    } else if (path === '/huge') {
      stream(res);
    } else if (path === '/huge-declared') {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Length': String(500 * 1024 * 1024),
      });
      res.write('a');
    } else if (path === '/stall') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.write('<html><body><main><p>The first words, then nothing');
    } else {
      res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  hits = [];
  vi.mocked(logger.warn).mockClear();
  mockEnv.TENANCY_MODE = 'multi';
});

const site = (path: string): string => `http://site.t16.test:${port}${path}`;
const viaTest = { dispatcher: testDispatcher };

async function expectRefused(
  run: Promise<unknown>,
  code: IntakeErrorCode,
  status = 422
): Promise<IntakeError> {
  const err = await run.then(
    () => {
      throw new Error('expected a refusal, got a result');
    },
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(IntakeError);
  const intake = err as IntakeError;
  expect(intake.code).toBe(code);
  expect(intake.status).toBe(status);
  return intake;
}

const warnedWith = (fields: Record<string, unknown>): void =>
  expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining(fields)
  );

describe('fetchPage — what it reads', () => {
  it('reads an HTML page: the main content only, titled from <title>', async () => {
    const page = await fetchPage(site('/register-to-vote'), viaTest);

    expect(page.format).toBe('html');
    expect(page.url).toBe(site('/register-to-vote'));
    expect(page.title).toBe('Register to vote - GOV.UK');
    // The page's own headline, sections and call to action (a button) are read.
    expect(page.text.startsWith('# Register to vote')).toBe(true);
    expect(page.text).toContain('## Register online');
    expect(page.text).toContain('It usually takes about 5 minutes.');
    expect(page.text).toContain('Start now');
    // The site around it is not: cookie banner, skip link, search, footer.
    for (const chrome of [
      'Cookies on GOV.UK',
      'Skip to main content',
      'Search GOV.UK',
      'Help us improve GOV.UK',
      'Crown copyright',
      'Open Government Licence',
    ]) {
      expect(page.text).not.toContain(chrome);
    }
    // No script or style source leaks through as text.
    expect(page.text).not.toMatch(/function\s*\(|govuk-template|\{\s*[a-z-]+\s*:/);
    expect(page.wordCount).toBeGreaterThan(500);
  });

  it('reads a PDF by its Content-Type, served under a .php path', async () => {
    const page = await fetchPage(site('/download.php?id=3'), viaTest);

    expect(page.format).toBe('pdf');
    expect(page.title).toBe('Harbour annual report');
    expect(page.pageCount).toBe(2);
    expect(page.text).toContain('more vessels this year than in any year before it');
  });

  it('reads plain text', async () => {
    const page = await fetchPage(site('/notes'), viaTest);
    expect(page.format).toBe('text');
    expect(page.text).toBe(fixture('feedback.txt').toString('utf8').trim().replace(/\r\n?/g, '\n'));
  });

  it('decodes plain text in the charset its Content-Type declares', async () => {
    const page = await fetchPage(site('/notes-latin1'), viaTest);
    expect(page.text).toBe('Café crème, £5');
  });

  it(`follows up to ${MAX_REDIRECTS} redirects, and reports where it landed`, async () => {
    const page = await fetchPage(site('/hop/1'), viaTest);

    expect(page.url).toBe(site('/register-to-vote'));
    expect(page.title).toBe('Register to vote - GOV.UK');
    expect(hits).toEqual(['/hop/1', '/hop/2', '/hop/3', '/hop/4', '/hop/5', '/register-to-vote']);
  });
});

describe('fetchPage — refusals', () => {
  it.each([
    'ftp://site.t16.test/file.txt',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
  ])('refuses %s before any connection', async (url) => {
    await expectRefused(fetchPage(url, viaTest), IntakeErrorCodes.URL_NOT_ALLOWED);
    expect(hits).toEqual([]);
  });

  it.each([
    'http://10.0.0.5/',
    'http://192.168.1.1/router',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::ffff:10.0.0.5]/',
    'http://metadata.google.internal/',
  ])('refuses the private address %s', async (url) => {
    const err = await expectRefused(fetchPage(url, viaTest), IntakeErrorCodes.URL_NOT_ALLOWED);
    expect(err.message).toBe('That is not a public web address.');
  });

  it('refuses a loopback IP literal even through a dispatcher that would allow loopback', async () => {
    // `net.connect` never calls `lookup` for a literal, so only the URL check
    // can stop it — and it does so whatever the dispatcher would have allowed.
    await expectRefused(
      fetchPage(`http://127.0.0.1:${port}/register-to-vote`, viaTest),
      IntakeErrorCodes.URL_NOT_ALLOWED
    );
    expect(hits).toEqual([]);
  });

  it('refuses a hostname that resolves to a private address, at connect time', async () => {
    await expectRefused(
      fetchPage('http://intranet.t16.test/', viaTest),
      IntakeErrorCodes.FETCH_FAILED
    );
    warnedWith({ reason: 'unsafe-address' });
  });

  it.each([
    ['/to-private', 'a private IP literal'],
    ['/to-metadata', 'the cloud metadata address'],
    ['/to-file', 'a file: URL'],
  ])('refuses a redirect (%s) to %s', async (path) => {
    const err = await expectRefused(
      fetchPage(site(path), viaTest),
      IntakeErrorCodes.URL_NOT_ALLOWED
    );
    expect(err.message).toMatch(/^That page redirects to an address that is not/);
    expect(hits).toEqual([path]);
  });

  it('refuses a redirect to a hostname that resolves inside the network', async () => {
    await expectRefused(fetchPage(site('/to-intranet'), viaTest), IntakeErrorCodes.FETCH_FAILED);
    // Logged against the hop that was refused, not the public URL asked for.
    warnedWith({ reason: 'unsafe-address', url: 'http://intranet.t16.test/' });
  });

  it(`refuses more than ${MAX_REDIRECTS} redirects`, async () => {
    const err = await expectRefused(
      fetchPage(site('/loop/0'), viaTest),
      IntakeErrorCodes.FETCH_FAILED
    );
    expect(err.message).toBe(`That page redirects more than ${MAX_REDIRECTS} times.`);
    // The first request and five redirects followed; the sixth is not.
    expect(hits).toHaveLength(MAX_REDIRECTS + 1);
  });

  it('refuses a redirect that does not say where to', async () => {
    const err = await expectRefused(
      fetchPage(site('/nowhere-redirect'), viaTest),
      IntakeErrorCodes.FETCH_FAILED
    );
    expect(err.message).toBe('That page redirects without saying where to.');
    expect(err.details).toEqual({ status: 302 });
  });

  it('stops reading an oversize body mid-stream, not after buffering it', async () => {
    const maxBytes = 64 * 1024;
    const err = await expectRefused(
      fetchPage(site('/huge'), { ...viaTest, limits: { maxBytes } }),
      IntakeErrorCodes.TOO_LARGE,
      413
    );
    expect(err.message).toBe('That page is larger than 64 KB, the largest we read.');
    // The connection was dropped while the server still had most of 50 MB to send.
    await huge.closed;
    expect(huge.finished).toBe(false);
    expect(huge.written).toBeLessThan(10 * 1024 * 1024);
  });

  it('refuses a body whose declared length is over the cap without reading it', async () => {
    await expectRefused(
      fetchPage(site('/huge-declared'), { ...viaTest, limits: { maxBytes: 64 * 1024 } }),
      IntakeErrorCodes.TOO_LARGE,
      413
    );
  });

  it('times out a body that stops arriving', async () => {
    const started = Date.now();
    const err = await expectRefused(
      fetchPage(site('/stall'), { ...viaTest, timeoutMs: 300 }),
      IntakeErrorCodes.FETCH_TIMEOUT
    );
    expect(err.message).toBe('That page took longer than 300 ms to load.');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it.each([
    ['/logo', 'image/png'],
    ['/untyped', null],
    ['/odd-type', 'constructor'],
  ])('refuses %s (content type %s)', async (path, contentType) => {
    const err = await expectRefused(
      fetchPage(site(path), viaTest),
      IntakeErrorCodes.UNSUPPORTED_TYPE,
      415
    );
    expect(err.details).toEqual({ contentType });
  });

  it('refuses an address with a user name or password in it', async () => {
    const err = await expectRefused(
      fetchPage(`http://user:secret@site.t16.test:${port}/notes`, viaTest),
      IntakeErrorCodes.URL_NOT_ALLOWED
    );
    expect(err.details).toEqual({ reason: 'credentials' });
    expect(hits).toHaveLength(0);
  });

  it('refuses a page that answers with an error status', async () => {
    const err = await expectRefused(
      fetchPage(site('/missing'), viaTest),
      IntakeErrorCodes.FETCH_FAILED
    );
    expect(err.details).toEqual({ status: 404 });
  });

  it('answers a name that does not resolve the same as one that resolves inside', async () => {
    const missing = await expectRefused(
      fetchPage('http://nowhere.t16.test/', viaTest),
      IntakeErrorCodes.FETCH_FAILED
    );
    const inside = await expectRefused(
      fetchPage('http://intranet.t16.test/', viaTest),
      IntakeErrorCodes.FETCH_FAILED
    );
    expect(missing.message).toBe(inside.message);
    expect(missing.details).toEqual(inside.details);
  });
});

describe('fetchPage — the safe dispatcher, by default', () => {
  it('refuses a hostname that DNS resolves to a private address', async () => {
    await expectRefused(fetchPage('http://intranet.t16.test/'), IntakeErrorCodes.FETCH_FAILED);
    warnedWith({ reason: 'unsafe-address' });
  });

  it('pins the connection as the install org, where outboundDispatcher() would not', async () => {
    // `loopback.t16.test` resolves, through the mocked `node:dns`, to the
    // local server. Only the safe dispatcher's lookup asks that module: an
    // unpinned fetch would ask the system resolver, fail with ENOTFOUND, and
    // log 'network'. So the 'unsafe-address' reason is what proves the pin.
    await runAsOrg(INSTALL_ORG_ID, async () => {
      expect(outboundDispatcher()).toBeUndefined();
      await expectRefused(
        fetchPage(`http://loopback.t16.test:${port}/register-to-vote`),
        IntakeErrorCodes.FETCH_FAILED
      );
    });
    expect(hits).toEqual([]);
    warnedWith({ reason: 'unsafe-address' });
  });

  it('pins at single tenancy too', async () => {
    mockEnv.TENANCY_MODE = 'single';
    expect(outboundDispatcher()).toBeUndefined();
    await expectRefused(
      fetchPage(`http://loopback.t16.test:${port}/register-to-vote`),
      IntakeErrorCodes.FETCH_FAILED
    );
    expect(hits).toEqual([]);
  });
});
