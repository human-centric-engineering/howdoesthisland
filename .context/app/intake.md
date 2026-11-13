# Content intake

How an uploaded file, or a page at a URL, becomes the text an assessment reads. Code:
`lib/app/intake/`. Plan: `f-intake` in [`planning/app-plan.md`](./planning/app-plan.md).

## `extractText(buffer, fileName, limits?)`

Pure: no database, no network. The caller decodes `source.file_base64` and
passes the bytes with the name the client gave. The extension picks the reader.

Returns `{ text, wordCount, title, format, pageCount?, warnings }`.

| Format     | Extensions      | Read by                  | Title                                   |
| ---------- | --------------- | ------------------------ | --------------------------------------- |
| PDF        | `.pdf`          | core `parseDocument()`   | PDF metadata, else file name            |
| Word       | `.docx`         | mammoth's HTML, here     | first heading, else file name           |
| PowerPoint | `.pptx`         | `lib/app/intake/pptx.ts` | deck metadata, else first slide's title |
| HTML       | `.html`, `.htm` | core `parseDocument()`   | `<title>`, `og:title`, first `<h1>`     |
| Markdown   | `.md`           | core `parseDocument()`   | first `# ` heading outside a code fence |
| Plain text | `.txt`          | core `parseDocument()`   | file name                               |

`wordCount` counts words the way the engine does (`engine/text.ts`), so the
number a client sees before an assessment matches the one the engine uses.

**Where intake departs from what core returns:**

- **DOCX** is read here, from mammoth's HTML. Core's Markdown route inlines
  every picture as a base64 data URI (a page with a logo then trips
  `maxChars`), keeps Markdown syntax (`__bold__`, `[text](url)`) and drops a
  heading with no body under it. Here pictures are removed, each paragraph,
  heading, list item and table cell is a paragraph of text, and every heading
  is kept. Footnote markers and their back-links are dropped. Its XML is
  charged to `maxXmlBytes` before mammoth reads it, as a PPTX's is.
- **PPTX** is read here: core has no PowerPoint parser. Slides come in
  _presented_ order (`ppt/presentation.xml`'s slide list), not `slideN.xml`
  order, because a slide keeps its file number when it is moved. Each slide's
  speaker notes follow it. Hidden slides (`show="0"` or `"false"`) are skipped with a warning. Slide
  numbers, dates, footers and headers are dropped.

## `fetchPage(url, options?)`

Fetches the page at `source.url` and returns `extractText()`'s result plus
`url`, where the content came from after redirects. The URL is chosen by
whoever calls, anonymous free scans included, so every URL is treated as
hostile:

- **http(s) only, public addresses only, on every hop.** Each URL, the first
  and every redirect target, goes through `checkSafeProviderUrl()`. That check
  is what refuses an IP literal (`http://10.0.0.5/`): `net.connect` never
  calls `lookup` for a literal, so the dispatcher cannot see one.
- **Every connection is pinned** through `createSafeDispatcher()`, which
  refuses a hostname that resolves to a private address, at connect time (no
  DNS rebinding window). This applies to every caller. **Not
  `outboundDispatcher()`**: that gives no dispatcher for the install org, a
  system scope or `TENANCY_MODE=single`, and the free scan runs as the install
  org.
- **Redirects are followed by hand**, at most `MAX_REDIRECTS` (5).
- **The body is streamed under `maxBytes`** (a declared `Content-Length` over
  it is refused unread). One `FETCH_TIMEOUT_MS` (15 s) covers every hop and the
  body, but not parsing afterwards.

The type comes from `Content-Type`, never the URL's extension, so
`/pricing.php` served as HTML is read as HTML. HTML, XHTML, PDF, plain text,
Markdown, DOCX and PPTX are read. HTML goes through `mainContent()`
(`main-content.ts`): it reads `<main>`, else `[role=main]`, else `<article>`,
else `<body>`, after removing `nav`, `aside`, search forms, scripts, hidden
elements and the site's banner and footer. A `header` or `footer` is removed
only when it is not inside `article`, `aside`, `main`, `nav`, `section` or
`[role=main]` (the ARIA rule), so a hero headline in `<main><header>` stays.
Buttons and other forms stay too: a sign-up form is often the call to action,
and ASP.NET WebForms wraps the whole page in one `<form>`. Core's
`parseHtml()` removes all of these, which is why an uploaded `.html` and a fetched page
are read differently. The title is `<title>`, else `og:title`, else the first
`<h1>`, else the host.

A name that does not resolve and a name that resolves inside the network get
the same answer, so the answer cannot be used to map the network. The log
records which one it was (`reason: 'unsafe-address' | 'network'`).

## Refusals

Every refusal is an `IntakeError` (an `APIError`), so a route that lets it
propagate answers with the status and code below.

| Code                | Status | When                                                                                                                 |
| ------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `INVALID_FILE_TYPE` | 415    | not one of the extensions above (CSV and EPUB included); for `fetchPage`, a `Content-Type` it does not read, or none |
| `FILE_TOO_LARGE`    | 413    | over `maxBytes` (checked first), or a PPTX or DOCX whose XML expands past `maxXmlBytes`                              |
| `TOO_MANY_PAGES`    | 422    | a PDF over `maxPages` pages, or a PPTX over `maxPages` slides (hidden included)                                      |
| `PDF_HAS_NO_TEXT`   | 422    | the PDF has no text at all: scanned or blank                                                                         |
| `NO_TEXT`           | 422    | any other file with no text                                                                                          |
| `TEXT_TOO_LONG`     | 422    | more than `maxChars` characters of extracted text                                                                    |
| `FILE_UNREADABLE`   | 422    | the bytes are not the format the extension names (the cause is logged, not sent)                                     |
| `URL_NOT_ALLOWED`   | 422    | `fetchPage`: not http(s), or not a public address as written, on any hop                                             |
| `FETCH_FAILED`      | 422    | `fetchPage`: unreachable, resolves to a private address, more than 5 redirects, or not 2xx                           |
| `FETCH_TIMEOUT`     | 422    | `fetchPage`: the fetch, body included, took longer than the timeout                                                  |

Text over the limit is **refused, never truncated** (plan §8.2): an assessment
of a document's first part reads as an assessment of all of it.

## Limits

`DEFAULT_INTAKE_LIMITS`; pass a partial `limits` to tighten one.

| Limit         | Default | Why                                                                                                                |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `maxBytes`    | 10 MB   | a text-heavy deck with some images                                                                                 |
| `maxPages`    | 100     | PPTX: checked before any slide is read. PDF: checked after core parses it all, so there `maxBytes` bounds the work |
| `maxChars`    | 40,000  | the pipeline's content limit, `MAX_TEXT_CHARS` (plan §8.2)                                                         |
| `maxXmlBytes` | 20 MB   | a small PPTX can inflate to gigabytes; parts are streamed and the read stops here                                  |

A route has its own request-body limit too. On Vercel that is 4.5 MB, which is
about a 3.3 MB file once base64-encoded, so on that host the platform refuses a
large upload before `maxBytes` is reached.

## Tests and fixtures

`tests/unit/lib/app/intake/` runs real fixture files through the real parsers,
with nothing mocked. The binary fixtures in `tests/fixtures/app/intake/` are
built by `make-fixtures.py` there. The deck's slide files are deliberately out
of presented order, and a test checks that they still are, so the order test
cannot pass by accident.

`fetch-page.test.ts` makes real fetches (undici's own `fetch`, because
`tests/setup.ts` blocks the global one) to a local server, under made-up
hostnames that an injected resolver answers. `gov-uk-register-to-vote.html` is
a real page saved as served (see the fixtures' `README.md`). It is in
`.prettierignore` so it stays byte-identical.
