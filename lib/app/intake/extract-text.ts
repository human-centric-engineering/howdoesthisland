/**
 * Turn an uploaded file into the text an assessment reads (t-15).
 *
 * Reads PDF, DOCX, PPTX, HTML, Markdown and plain text. PowerPoint is read
 * here (`pptx.ts`); every other format goes through core's `parseDocument()`,
 * which this wraps rather than forks. Anything else is refused, as is a file
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

import { parseDocument, type ParsedDocument } from '@/lib/orchestration/knowledge/parsers';
import { IntakeError, IntakeErrorCodes } from '@/lib/app/intake/errors';
import { extractPptx } from '@/lib/app/intake/pptx';

/** The pipeline's content limit, in characters (plan §8.2). */
export const MAX_TEXT_CHARS = 40_000;

export interface IntakeLimits {
  /** Largest file read, in bytes. Checked before any parsing. */
  maxBytes: number;
  /** Most PDF pages or PPTX slides read. */
  maxPages: number;
  /** Most characters of extracted text accepted. */
  maxChars: number;
  /** PPTX only: most bytes of slide XML read once decompressed. */
  maxXmlBytes: number;
}

/**
 * Defaults. 10 MB covers a text-heavy deck with a few images, and 40,000
 * characters is about 25 pages of prose, so 100 pages or slides is already
 * generous: what stops a long document in practice is `maxChars`. The page cap
 * exists to stop a cheap file making the parser do a lot of work for nothing.
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

/** Counted the way the assessment engine counts (`engine/text.ts` `words`). */
const WORD = /[\p{L}\p{N}'’-]+/gu;
export const countWords = (text: string): number => text.match(WORD)?.length ?? 0;

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

/**
 * Mammoth writes DOCX as Markdown and escapes punctuation (`harbours\.`).
 * Those backslashes are not in the document, so they come out here.
 */
const unescapeMarkdown = (text: string): string =>
  text.replace(/\\([\\`*_{}[\]()#+\-.!<>|~])/g, '$1');

/**
 * Core's DOCX `fullText` joins section bodies and drops their headings. The
 * headings are part of what a reader reads, so the text is rebuilt from the
 * sections with each heading as its own paragraph.
 */
function docxText(parsed: ParsedDocument): string {
  return parsed.sections.map((s) => [s.title, s.content].filter(Boolean).join('\n\n')).join('\n\n');
}

interface Raw {
  text: string;
  title: string;
  pageCount?: number;
  warnings: string[];
}

async function readWithCore(
  buffer: Buffer,
  fileName: string,
  format: Exclude<IntakeFormat, 'pptx'>,
  limits: IntakeLimits
): Promise<Raw> {
  let parsed: ParsedDocument;
  try {
    parsed = await parseDocument(buffer, fileName);
  } catch (err) {
    throw new IntakeError(
      IntakeErrorCodes.UNREADABLE,
      `This file could not be read as ${format.toUpperCase()}.`,
      {
        reason: err instanceof Error ? err.message : 'parse failed',
      }
    );
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
      // The parser's own per-page verdict, not a second heuristic.
      if (!pages.some((p) => p.hasText)) {
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
    case 'docx':
      return {
        text: unescapeMarkdown(docxText(parsed)),
        title: unescapeMarkdown(parsed.title),
        warnings: parsed.warnings,
      };
    case 'markdown': {
      const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(parsed.fullText)?.[1];
      return { text: parsed.fullText, title: h1 ?? parsed.title, warnings: parsed.warnings };
    }
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

  const raw: Raw =
    format === 'pptx'
      ? await extractPptx(buffer, { maxSlides: lim.maxPages, maxXmlBytes: lim.maxXmlBytes }).then(
          (r) => ({ text: r.text, title: r.title, pageCount: r.slideCount, warnings: r.warnings })
        )
      : await readWithCore(buffer, fileName, format, lim);

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
