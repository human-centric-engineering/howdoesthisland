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
 * `aside`, `main`, `nav` or `section`), and buttons stay.
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
  'script, style, noscript, template, iframe, svg, form, nav, aside, ' +
  '[role=navigation], [role=complementary], [role=banner], [role=contentinfo], [role=search], ' +
  '[hidden], [aria-hidden=true]';

/** Sectioning elements inside which a `header`/`footer` belongs to that section, not the site. */
const SECTIONING = 'article, aside, main, nav, section';

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
  const dom = new JSDOM(html, { contentType: htmlContentType(contentType) });
  const { document: doc } = dom.window;

  const title =
    cleanInline(doc.querySelector('title')?.textContent) ||
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
 * jsdom accepts only an HTML or XML type here, and throws on anything else.
 * The fetcher calls this for `text/html` and `application/xhtml+xml`; XHTML is
 * read as HTML (served pages are rarely well-formed XML), keeping its charset.
 */
function htmlContentType(contentType: string): string {
  const charset = /;\s*charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType)?.[1];
  return charset ? `text/html; charset=${charset}` : 'text/html';
}
