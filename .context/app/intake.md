# Content intake

How an uploaded file becomes the text an assessment reads. Code:
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

## Refusals

Every refusal is an `IntakeError` (an `APIError`), so a route that lets it
propagate answers with the status and code below.

| Code                | Status | When                                                                                    |
| ------------------- | ------ | --------------------------------------------------------------------------------------- |
| `INVALID_FILE_TYPE` | 415    | not one of the extensions above (CSV and EPUB included)                                 |
| `FILE_TOO_LARGE`    | 413    | over `maxBytes` (checked first), or a PPTX or DOCX whose XML expands past `maxXmlBytes` |
| `TOO_MANY_PAGES`    | 422    | a PDF over `maxPages` pages, or a PPTX over `maxPages` slides (hidden included)         |
| `PDF_HAS_NO_TEXT`   | 422    | the PDF has no text at all: scanned or blank                                            |
| `NO_TEXT`           | 422    | any other file with no text                                                             |
| `TEXT_TOO_LONG`     | 422    | more than `maxChars` characters of extracted text                                       |
| `FILE_UNREADABLE`   | 422    | the bytes are not the format the extension names (the cause is logged, not sent)        |

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
