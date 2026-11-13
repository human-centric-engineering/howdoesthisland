/**
 * A web page reduced to what its author wrote for it (t-16).
 *
 * A fetched page arrives with the site around it: navigation, a cookie
 * banner, a search form, a footer of links. Assessing that would assess the
 * site, not the page. So the page's own landmark is read — `<main>`, else
 * `[role=main]`, else `<article>`, else `<body>` — with the site's chrome
 * removed first.
 *
 * **Why not core's `parseHtml()`** (which `extractText()` uses for an
 * uploaded `.html`): it removes every `header`, `footer`, `form` and `button`
 * wherever it sits. On a landing page the headline is often inside
 * `<main><header>`, and the call to action is a button; both are what an
 * assessment of a landing page reads. Here `header` and `footer` go only when
 * they are the page's banner or footer (the ARIA rule: not inside `article`,
 * `aside`, `main`, `nav` or `section`), and buttons and forms stay. A form
 * is kept because a sign-up form is often the call to action, and ASP.NET
 * WebForms wraps the whole page in one; a search form goes by its role, and
 * inputs carry no text to read.
 *
 * jsdom does not run scripts or fetch subresources here (no `runScripts`, no
 * `resources`), so parsing a hostile page is safe. It is given the bytes and
 * the response's content type, so it reads the page in the encoding the page
 * declares.
 */

import { JSDOM } from 'jsdom';
import { cleanInline, extractText } from '@/lib/orchestration/knowledge/parsers/dom-text';

/** Never part of what the page says, wherever they sit. */
const ALWAYS_REMOVED =
  'script, style, noscript, template, iframe, svg, nav, aside, ' +
  '[role=navigation], [role=complementary], [role=banner], [role=contentinfo], [role=search], ' +
  '[hidden], [aria-hidden=true]';

/**
 * Sectioning elements inside which a `header`/`footer` belongs to that section,
 * not the site. `aside` and `nav` complete the ARIA rule, though both are gone
 * by the time this is read.
 */
const SECTIONING = 'article, aside, main, nav, section, [role=main]';

export interface MainContent {
  /** The main content as text, block structure kept, headings as Markdown. */
  text: string;
  /** `<title>`, else `og:title`, else the first `<h1>`; empty when the page has none. */
  title: string;
  /** Which element the text was read from. */
  source: 'main' | 'article' | 'body';
}

/**
 * @param html        the page, as fetched bytes or a string
 * @param contentType the response's `Content-Type`, for its charset
 */
export function mainContent(html: Buffer | string, contentType = 'text/html'): MainContent {
  const dom = new JSDOM(html, { contentType: htmlContentType(contentType, html) });
  const { document: doc } = dom.window;

  // `doc.title`, not `querySelector('title')`: that also matches an inline
  // SVG icon's `<title>`.
  const title =
    cleanInline(doc.title) ||
    cleanInline(doc.querySelector('meta[property="og:title"]')?.getAttribute('content')) ||
    cleanInline(doc.querySelector('h1')?.textContent);

  for (const el of Array.from(doc.querySelectorAll(ALWAYS_REMOVED))) el.remove();
  for (const el of Array.from(doc.querySelectorAll('header, footer'))) {
    if (!el.parentElement?.closest(SECTIONING)) el.remove();
  }

  const main = doc.querySelector('main, [role=main]');
  const article = main ? null : doc.querySelector('article');
  const root = main ?? article ?? doc.body;
  const source = main ? 'main' : article ? 'article' : 'body';

  return { text: root ? extractText(root, dom.window) : '', title, source };
}

/**
 * The type jsdom reads the page as. jsdom accepts only an HTML or XML type
 * here, and throws on anything else. The fetcher calls this for `text/html`
 * and `application/xhtml+xml`; XHTML is read as HTML (served pages are rarely
 * well-formed XML), keeping its charset.
 *
 * jsdom finds the encoding the way a browser does: a BOM, then this charset,
 * then a `<meta charset>` in the first 1,024 bytes. With none of them it falls back to
 * windows-1252, which garbles every non-ASCII character of a UTF-8 page that
 * declares nothing. So a page that declares nothing is read as UTF-8.
 */
function htmlContentType(contentType: string, html: Buffer | string): string {
  const charset = charsetOf(contentType);
  if (charset) return `text/html; charset=${charset}`;
  if (typeof html === 'string') return 'text/html';
  // Latin-1 maps each byte to one character, so the prescan cannot fail to decode.
  const head = html.subarray(0, 1024).toString('latin1');
  // A BOM needs no check: it outranks the charset given here.
  return /<meta[^>]+charset/i.test(head) ? 'text/html' : 'text/html; charset=utf-8';
}

/** The `charset` parameter of a `Content-Type`, if it has one. */
export function charsetOf(contentType: string): string | undefined {
  return /;\s*charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType)?.[1];
}
