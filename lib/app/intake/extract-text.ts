/**
 * Turn an uploaded file into the text an assessment reads (t-15).
 *
 * Reads PDF, DOCX, PPTX, HTML, Markdown and plain text. PowerPoint
 * (`pptx.ts`) and Word (below) are read here; every other format goes through
 * core's `parseDocument()`, which this wraps rather than forks. Anything else is refused, as is a file
 * that is too big, too long, or has no text, each with its own code
 * (`IntakeErrorCodes`).
 *
 * **Refused, never truncated.** Text over `MAX_TEXT_CHARS` is an error (plan
 * §8.2): an assessment of the first part of a document reads as an assessment
 * of all of it.
 *
 * Pure: no database, no network. The caller decodes `source.file_base64` and
 * passes the bytes with the name the client gave.
 */

import { JSDOM } from 'jsdom';
import mammoth from 'mammoth';
import { parseDocument, type ParsedDocument } from '@/lib/orchestration/knowledge/parsers';
import JSZip from 'jszip';
import { IntakeError, IntakeErrorCodes, unreadableFile } from '@/lib/app/intake/errors';
import { extractPptx, readPart, type ReadBudget } from '@/lib/app/intake/pptx';
import { wordCount } from '@/lib/app/frameworks/howdoesthisland/engine/text';

/** The pipeline's content limit, in characters (plan §8.2). */
export const MAX_TEXT_CHARS = 40_000;

export interface IntakeLimits {
  /** Largest file read, in bytes. Checked before any parsing. */
  maxBytes: number;
  /** Most PDF pages or PPTX slides read. */
  maxPages: number;
  /** Most characters of extracted text accepted. */
  maxChars: number;
  /** PPTX and DOCX: most bytes of XML read once decompressed. */
  maxXmlBytes: number;
}

/**
 * Defaults. 10 MB covers a text-heavy deck with a few images, and 40,000
 * characters is about 25 pages of prose, so 100 pages or slides is already
 * generous: what stops a long document in practice is `maxChars`. For PPTX the
 * page cap is checked before any slide is read; for PDF it is checked after
 * core's parser has run, so there `maxBytes` is what bounds the parser's work.
 */
export const DEFAULT_INTAKE_LIMITS: IntakeLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxPages: 100,
  maxChars: MAX_TEXT_CHARS,
  maxXmlBytes: 20 * 1024 * 1024,
};

export type IntakeFormat = 'pdf' | 'docx' | 'pptx' | 'html' | 'markdown' | 'text';

const FORMATS: Record<string, IntakeFormat> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.pptx': 'pptx',
  '.html': 'html',
  '.htm': 'html',
  '.md': 'markdown',
  '.txt': 'text',
};

/** Extensions intake reads, for a client to list. */
export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(FORMATS);

export interface ExtractedText {
  text: string;
  wordCount: number;
  /** From the file's own metadata or first heading, else its name without the extension. */
  title: string;
  format: IntakeFormat;
  /** Pages (PDF) or slides (PPTX); absent for formats without them. */
  pageCount?: number;
  /** Things the reader should know that did not stop extraction. */
  warnings: string[];
}

/** Counted the way the assessment engine counts: its own `wordCount`. */
export const countWords = wordCount;

const baseName = (fileName: string): string => fileName.replace(/\.[^.]+$/, '');

/**
 * `path.extname`, lower-cased, without `path` (Node-only, barred from
 * `lib/app/**`): a leading dot is a hidden file's name, not an extension.
 */
function extensionOf(fileName: string): string {
  const base = fileName.slice(Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/** Line endings to LF, trailing spaces off, runs of blank lines to one. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Mammoth's HTML elements that are a paragraph of their own in the text. */
const DOCX_BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, td, th';
/** Footnote and endnote markers (`[1]`) and their back-links (`↑`). */
const DOCX_NOTE_LINKS =
  'a[id^="footnote-ref-"], a[id^="endnote-ref-"], a[href^="#footnote-ref-"], a[href^="#endnote-ref-"]';

/**
 * Every XML part of a DOCX, charged to the expanded-size budget before
 * mammoth reads any of it: a small zip can inflate to gigabytes.
 */
async function checkDocxExpansion(buffer: Buffer, maxXmlBytes: number): Promise<void> {
  const zip = await JSZip.loadAsync(buffer);
  const budget: ReadBudget = { used: 0, max: maxXmlBytes };
  for (const file of Object.values(zip.files)) {
    if (!file.dir && /\.(xml|rels)$/i.test(file.name)) await readPart(zip, file.name, budget);
  }
}

/**
 * Word, read here rather than through core. Core converts DOCX to Markdown:
 * that inlines every picture as a base64 data URI, keeps Markdown syntax
 * (`__bold__`, `[text](url)`), and drops any heading with no body under it.
 * None of that is in what a reader reads. Mammoth's HTML is read as a DOM
 * instead: pictures removed, each block its own paragraph, the first heading
 * the title.
 */
async function readDocx(buffer: Buffer, maxXmlBytes: number): Promise<Raw> {
  await checkDocxExpansion(buffer, maxXmlBytes);
  const result = await mammoth.convertToHtml(
    { buffer },
    // Never read or encode a picture: it is dropped below anyway.
    { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })) }
  );
  const { document: doc } = new JSDOM('').window;
  const body = doc.createElement('body');
  body.innerHTML = result.value;
  for (const el of Array.from(body.querySelectorAll(`img, ${DOCX_NOTE_LINKS}`))) el.remove();
  // Words either side of a line break, or of a block inside a block (a
  // paragraph in a table cell, a nested list), stay apart.
  for (const el of Array.from(body.querySelectorAll(`br, ${DOCX_BLOCKS}`))) {
    el.after(doc.createTextNode(' '));
  }

  const paragraphs = Array.from(body.querySelectorAll(DOCX_BLOCKS))
    // A block inside another (a paragraph in a table cell) is read by its outer one.
    .filter((el) => !el.parentElement?.closest(DOCX_BLOCKS))
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const heading = body.querySelector('h1, h2, h3, h4, h5, h6')?.textContent ?? '';

  return {
    text: paragraphs.join('\n\n'),
    title: heading.replace(/\s+/g, ' ').trim(),
    warnings: result.messages.filter((m) => m.type === 'warning').map((m) => `DOCX: ${m.message}`),
  };
}

/** The first ATX H1 outside a fenced code block, inline markup removed. */
function markdownTitle(markdown: string): string | undefined {
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence && f) {
      fence = f[1];
      continue;
    }
    if (fence) {
      // Closed only by the same character, at least as long, with nothing after it.
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
      continue;
    }
    const h1 = /^ {0,3}#[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line)?.[1];
    if (!h1) continue;
    const plain = h1
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Only at word edges, as CommonMark does: `my_var_name` and `2*3*4` stay.
      .replace(/(^|[^\p{L}\p{N}])(\*\*|__|\*|_|`)(?=\S)(.+?)(?<=\S)\2(?![\p{L}\p{N}])/gu, '$1$3')
      .trim();
    if (plain) return plain;
  }
  return undefined;
}

interface Raw {
  text: string;
  title: string;
  pageCount?: number;
  warnings: string[];
}

const unreadable = (format: IntakeFormat, err: unknown): IntakeError =>
  unreadableFile(format.toUpperCase(), err);

async function readWithCore(
  buffer: Buffer,
  fileName: string,
  format: Exclude<IntakeFormat, 'pptx' | 'docx'>,
  limits: IntakeLimits
): Promise<Raw> {
  let parsed: ParsedDocument;
  try {
    parsed = await parseDocument(buffer, fileName);
  } catch (err) {
    throw unreadable(format, err);
  }

  switch (format) {
    case 'pdf': {
      const pages = parsed.pageInfo ?? [];
      if (pages.length > limits.maxPages) {
        throw new IntakeError(
          IntakeErrorCodes.TOO_MANY_PAGES,
          `This PDF has ${pages.length} pages; we read up to ${limits.maxPages}.`,
          { pages: pages.length, maxPages: limits.maxPages }
        );
      }
      // Any text at all. Not the parser's `hasText`: that is under 50
      // characters a page, and a short digital PDF is not a scanned one.
      if (!tidy(parsed.fullText)) {
        throw new IntakeError(
          IntakeErrorCodes.PDF_HAS_NO_TEXT,
          'This PDF has no text we can read. It may be scanned or blank: export it from the original document, or paste the text in.',
          { pages: pages.length }
        );
      }
      return {
        text: parsed.fullText,
        title: parsed.title,
        pageCount: pages.length,
        // Per-page "likely scanned" ranges stay, worded by the parser.
        warnings: parsed.warnings,
      };
    }
    case 'markdown':
      return {
        text: parsed.fullText,
        title: markdownTitle(parsed.fullText) ?? parsed.title,
        warnings: parsed.warnings,
      };
    case 'html':
    case 'text':
      return { text: parsed.fullText, title: parsed.title, warnings: parsed.warnings };
  }
}

/**
 * The text of a file, with its word count, title and warnings.
 *
 * @param buffer   the file's bytes
 * @param fileName the name the client gave; its extension picks the reader
 * @param limits   overrides for the defaults (tests, or a stricter caller)
 * @throws IntakeError for every refusal; the code says which
 */
export async function extractText(
  buffer: Buffer,
  fileName: string,
  limits: Partial<IntakeLimits> = {}
): Promise<ExtractedText> {
  const lim: IntakeLimits = { ...DEFAULT_INTAKE_LIMITS, ...limits };
  const ext = extensionOf(fileName);
  const format = FORMATS[ext];

  if (!format) {
    throw new IntakeError(
      IntakeErrorCodes.UNSUPPORTED_TYPE,
      `We can't read ${ext ? `${ext} files` : 'files without an extension'}. Upload a PDF, Word document, PowerPoint deck, web page, Markdown or plain text file.`,
      { extension: ext, supported: SUPPORTED_EXTENSIONS }
    );
  }

  if (buffer.length > lim.maxBytes) {
    throw new IntakeError(
      IntakeErrorCodes.TOO_LARGE,
      `This file is ${(buffer.length / 1_048_576).toFixed(1)} MB; the largest we read is ${Math.round(lim.maxBytes / 1_048_576)} MB.`,
      { bytes: buffer.length, maxBytes: lim.maxBytes }
    );
  }

  let raw: Raw;
  if (format === 'pptx') {
    const r = await extractPptx(buffer, { maxSlides: lim.maxPages, maxXmlBytes: lim.maxXmlBytes });
    raw = { text: r.text, title: r.title, pageCount: r.slideCount, warnings: r.warnings };
  } else if (format === 'docx') {
    raw = await readDocx(buffer, lim.maxXmlBytes).catch((err: unknown) => {
      throw err instanceof IntakeError ? err : unreadable(format, err);
    });
  } else {
    raw = await readWithCore(buffer, fileName, format, lim);
  }

  const text = tidy(raw.text);
  if (!text) {
    throw new IntakeError(IntakeErrorCodes.NO_TEXT, 'This file has no text to assess.', { format });
  }
  if (text.length > lim.maxChars) {
    throw new IntakeError(
      IntakeErrorCodes.TEXT_TOO_LONG,
      `This file has ${text.length.toLocaleString('en-GB')} characters of text; we assess up to ${lim.maxChars.toLocaleString('en-GB')}. Assess a shorter extract.`,
      { chars: text.length, maxChars: lim.maxChars }
    );
  }

  return {
    text,
    wordCount: countWords(text),
    title: raw.title.trim() || baseName(fileName),
    format,
    ...(raw.pageCount !== undefined && { pageCount: raw.pageCount }),
    warnings: raw.warnings,
  };
}
