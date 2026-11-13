/**
 * mainContent (t-16): which element a page is read from, what is removed
 * from it, and where its title comes from. The real-page check is in
 * `fetch-page.test.ts`, against the GOV.UK fixture.
 *
 * @see lib/app/intake/main-content.ts
 */

import { describe, expect, it } from 'vitest';
import { mainContent } from '@/lib/app/intake/main-content';

const page = (body: string, head = ''): string =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe('mainContent — where it reads from', () => {
  it('reads <main>, and keeps a hero header and call-to-action button inside it', () => {
    const r = mainContent(
      page(`
        <header><a href="/">Acme</a> <nav><a href="/pricing">Pricing</a></nav></header>
        <main>
          <header><h1>Ship invoices in a minute</h1><p>No spreadsheets.</p></header>
          <section><h2>Why</h2><p>Because time.</p><footer>Section note</footer></section>
          <button>Start free trial</button>
          <form><label>Email</label><input></form>
          <aside>Related posts</aside>
        </main>
        <footer>© Acme Ltd</footer>`)
    );

    expect(r.source).toBe('main');
    expect(r.text).toContain('# Ship invoices in a minute');
    expect(r.text).toContain('No spreadsheets.');
    expect(r.text).toContain('## Why');
    expect(r.text).toContain('Section note');
    expect(r.text).toContain('Start free trial');
    for (const gone of ['Acme', 'Pricing', 'Email', 'Related posts', '© Acme Ltd']) {
      expect(r.text).not.toContain(gone);
    }
  });

  it('reads [role=main] as <main>', () => {
    const r = mainContent(
      page('<div>Promo strip</div><div role="main"><p>The body copy.</p></div>')
    );
    expect(r.source).toBe('main');
    expect(r.text).toBe('The body copy.');
  });

  it('falls back to <article> when there is no main landmark', () => {
    const r = mainContent(page('<div>Promo strip</div><article><p>The story.</p></article>'));
    expect(r.source).toBe('article');
    expect(r.text).toBe('The story.');
  });

  it('falls back to <body>, without the site banner, footer or chrome', () => {
    const r = mainContent(
      page(`
        <header>Site name</header>
        <div role="banner">Banner</div>
        <div role="search">Search</div>
        <div role="contentinfo">Contact</div>
        <div hidden>Hidden</div><div aria-hidden="true">Decor</div>
        <script>var x = 1;</script><style>p{color:red}</style><noscript>Enable JS</noscript>
        <p>The only paragraph.</p>
        <footer>Footer links</footer>`)
    );
    expect(r.source).toBe('body');
    expect(r.text).toBe('The only paragraph.');
  });

  it('returns empty text for a page with no body content', () => {
    expect(mainContent(page('')).text).toBe('');
  });
});

describe('mainContent — title', () => {
  it('prefers <title>', () => {
    const r = mainContent(
      page(
        '<h1>Heading</h1>',
        '<title> Page  title </title><meta property="og:title" content="OG">'
      )
    );
    expect(r.title).toBe('Page title');
  });

  it('falls back to og:title, then the first <h1>, then nothing', () => {
    expect(
      mainContent(page('<h1>Heading</h1>', '<meta property="og:title" content="OG">')).title
    ).toBe('OG');
    expect(mainContent(page('<nav><h1>Inside nav</h1></nav>')).title).toBe('Inside nav');
    expect(mainContent(page('<p>No headings</p>')).title).toBe('');
  });

  it("does not take an inline SVG icon's <title> as the page's", () => {
    const r = mainContent(
      page(
        '<svg><title>Menu icon</title></svg><h1>Pricing</h1>',
        '<meta property="og:title" content="Acme pricing">'
      )
    );
    expect(r.title).toBe('Acme pricing');
  });
});

describe('mainContent — forms', () => {
  it('keeps a page whose whole body is one <form> (ASP.NET WebForms)', () => {
    const r = mainContent(
      page(`
        <form id="aspnetForm" method="post">
          <nav><a href="/">Home</a></nav>
          <main><h1>Bin collection days</h1><p>Bins are collected weekly.</p></main>
        </form>`)
    );
    expect(r.source).toBe('main');
    expect(r.text).toBe('# Bin collection days\n\nBins are collected weekly.');
  });

  it('removes a form that is only a form', () => {
    const r = mainContent(
      page('<main><p>Read this.</p><form><label>Subscribe</label><input></form></main>')
    );
    expect(r.text).toBe('Read this.');
  });
});

describe('mainContent — encoding', () => {
  const latin1 = Buffer.from(
    page('<main><p>Café crème</p></main>', '<title>Menu</title>'),
    'latin1'
  );

  it('decodes bytes in the charset the Content-Type declares', () => {
    expect(mainContent(latin1, 'text/html; charset=ISO-8859-1').text).toBe('Café crème');
    expect(mainContent(latin1, 'application/xhtml+xml; charset="iso-8859-1"').text).toBe(
      'Café crème'
    );
  });

  it('honours a <meta charset> when the Content-Type has none', () => {
    const declared = Buffer.from(
      page('<main><p>Caf\u00e9</p></main>', '<meta charset="iso-8859-1">'),
      'latin1'
    );
    expect(mainContent(declared, 'text/html').text).toBe('Café');
  });

  it('reads UTF-8 bytes when no charset is declared', () => {
    const utf8 = Buffer.from(page('<main><p>Café</p></main>'), 'utf8');
    expect(mainContent(utf8).text).toBe('Café');
  });
});
