/**
 * extractText (t-15): every format against a real fixture file, and every
 * refusal by its code.
 *
 * Nothing is mocked: the fixtures go through the real parsers (pdf-parse,
 * mammoth, jsdom, jszip), because what is under test is what comes out of a
 * real file. The binary fixtures are built by
 * `tests/fixtures/app/intake/make-fixtures.py`.
 *
 * @see lib/app/intake/extract-text.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { DEFAULT_INTAKE_LIMITS, MAX_TEXT_CHARS, extractText } from '@/lib/app/intake/extract-text';
import { IntakeError, IntakeErrorCodes, type IntakeErrorCode } from '@/lib/app/intake/errors';

const FIXTURES = join(process.cwd(), 'tests/fixtures/app/intake');
const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, name));

async function refusal(run: Promise<unknown>): Promise<IntakeError> {
  const err = await run.then(
    () => {
      throw new Error('expected a refusal, got a result');
    },
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(IntakeError);
  return err as IntakeError;
}

async function expectRefused(
  run: Promise<unknown>,
  code: IntakeErrorCode,
  status: number
): Promise<IntakeError> {
  const err = await refusal(run);
  expect(err.code).toBe(code);
  expect(err.status).toBe(status);
  return err;
}

describe('extractText — formats', () => {
  it('reads a PDF: text from every page, metadata title, page count', async () => {
    const r = await extractText(fixture('report.pdf'), 'report.pdf');

    expect(r.format).toBe('pdf');
    expect(r.title).toBe('Harbour annual report');
    expect(r.pageCount).toBe(2);
    expect(r.text).toContain('more vessels this year than in any year before it');
    expect(r.text).toContain('two new berths opening in spring');
    expect(r.text.indexOf('Harbour annual report')).toBeLessThan(r.text.indexOf('Outlook'));
    expect(r.wordCount).toBe(54);
    expect(r.warnings).toEqual([]);
  });

  it('reads a DOCX: headings kept, Markdown escapes removed', async () => {
    const r = await extractText(fixture('letter.docx'), 'letter.docx');

    expect(r.format).toBe('docx');
    expect(r.title).toBe('Quarterly letter to customers');
    // Core's fullText drops headings; the reader reads them, so they stay.
    expect(r.text).toBe(
      'Quarterly letter to customers\n\n' +
        'This quarter we shipped the berth planner to four new harbours. ' +
        'Turnaround fell by a third where it was used every day.\n\n' +
        'What changes next\n\n' +
        'From January, every agent sees the same plan at the same time.'
    );
    expect(r.text).not.toContain('\\');
    expect(r.wordCount).toBe(41);
    expect(r.pageCount).toBeUndefined();
  });

  it('reads a PPTX in presented order, each slide followed by its notes', async () => {
    const r = await extractText(fixture('deck.pptx'), 'deck.pptx');

    expect(r.format).toBe('pptx');
    expect(r.title).toBe('Harbour Seed Round');
    expect(r.pageCount).toBe(4);
    expect(r.text).toBe(
      [
        'The problem\nSmall ports lose a day per vessel to paperwork.\nNobody owns the handover.',
        'Open with the Falmouth story. Pause after the number.',
        'Our answer\nOne shared berth plan that every agent can edit.',
        'The ask\nWe are raising 1.2 million to reach twelve ports.',
        'Name the lead investor only if asked.',
      ].join('\n\n')
    );
    expect(r.wordCount).toBe(54);
  });

  it('skips a hidden slide and says so', async () => {
    const r = await extractText(fixture('deck.pptx'), 'deck.pptx');

    expect(r.text).not.toContain('Backup appendix');
    expect(r.warnings).toEqual(['Skipped 1 hidden slide: they are not shown to an audience.']);
  });

  it('keeps the PPTX fixture honest: its slide files are not in presented order', async () => {
    // Without this the order test above would pass for a reader that sorts
    // slideN.xml numerically, which is the mistake it exists to catch.
    const zip = await JSZip.loadAsync(fixture('deck.pptx'));
    const slide2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(slide2).toContain('The ask');
  });

  it('reads HTML: page title, main content only', async () => {
    const r = await extractText(fixture('page.html'), 'page.html');

    expect(r.format).toBe('html');
    expect(r.title).toBe('Why harbours still run on paper');
    expect(r.text).toContain('When the copies disagree, the ship waits.');
    expect(r.text).not.toMatch(/tracking|Home|All rights reserved/);
    expect(r.wordCount).toBe(27);
  });

  it('reads Markdown: the first H1 is the title, the text is unchanged', async () => {
    const r = await extractText(fixture('notes.md'), 'notes.md');

    expect(r.format).toBe('markdown');
    expect(r.title).toBe('Launch notes');
    expect(r.text).toBe(fixture('notes.md').toString('utf8').trim());
    expect(r.wordCount).toBe(36);
  });

  it('reads plain text: CRLF normalised, file name as title', async () => {
    const r = await extractText(fixture('feedback.txt'), 'feedback.txt');

    expect(r.format).toBe('text');
    expect(r.title).toBe('feedback');
    expect(r.text).toBe('Thank you for the berth plan.\nIt saved our crew a full day in port.');
    expect(r.wordCount).toBe(15);
  });

  it('matches the extension case-insensitively', async () => {
    const r = await extractText(fixture('deck.pptx'), 'DECK.PPTX');
    expect(r.format).toBe('pptx');
  });
});

describe('extractText — refusals', () => {
  it.each(['data.csv', 'book.epub', 'deck.key', 'README', '.txt', 'notes.txt/README'])(
    'refuses %s as an unsupported type',
    async (name) => {
      const err = await expectRefused(
        extractText(Buffer.from('a,b\n1,2'), name),
        IntakeErrorCodes.UNSUPPORTED_TYPE,
        415
      );
      expect(err.details).toMatchObject({ supported: expect.arrayContaining(['.pptx', '.pdf']) });
    }
  );

  it('refuses a file over the byte cap before trying to parse it', async () => {
    // Not a PDF at all: reaching the parser would answer FILE_UNREADABLE.
    const big = Buffer.alloc(2048, 0x41);
    const err = await expectRefused(
      extractText(big, 'big.pdf', { maxBytes: 1024 }),
      IntakeErrorCodes.TOO_LARGE,
      413
    );
    expect(err.details).toEqual({ bytes: 2048, maxBytes: 1024 });
  });

  it('defaults the byte cap to 10 MB', async () => {
    expect(DEFAULT_INTAKE_LIMITS.maxBytes).toBe(10 * 1024 * 1024);
    const justOver = Buffer.alloc(DEFAULT_INTAKE_LIMITS.maxBytes + 1, 0x41);
    await expectRefused(extractText(justOver, 'big.txt'), IntakeErrorCodes.TOO_LARGE, 413);
  });

  it('refuses a PDF over the page cap', async () => {
    const err = await expectRefused(
      extractText(fixture('report.pdf'), 'report.pdf', { maxPages: 1 }),
      IntakeErrorCodes.TOO_MANY_PAGES,
      422
    );
    expect(err.details).toEqual({ pages: 2, maxPages: 1 });
  });

  it('refuses a PPTX over the slide cap, counting hidden slides', async () => {
    const err = await expectRefused(
      extractText(fixture('deck.pptx'), 'deck.pptx', { maxPages: 3 }),
      IntakeErrorCodes.TOO_MANY_PAGES,
      422
    );
    expect(err.details).toEqual({ slides: 4, maxSlides: 3 });
  });

  it('accepts a PPTX exactly at the slide cap', async () => {
    const r = await extractText(fixture('deck.pptx'), 'deck.pptx', { maxPages: 4 });
    expect(r.pageCount).toBe(4);
  });

  it('refuses a scanned PDF (an image of text, no text layer)', async () => {
    const err = await expectRefused(
      extractText(fixture('scanned.pdf'), 'scanned.pdf'),
      IntakeErrorCodes.PDF_HAS_NO_TEXT,
      422
    );
    expect(err.message).toMatch(/scanned/);
  });

  it('refuses an empty PDF', async () => {
    await expectRefused(
      extractText(fixture('empty.pdf'), 'empty.pdf'),
      IntakeErrorCodes.PDF_HAS_NO_TEXT,
      422
    );
  });

  it('refuses any other file with no text', async () => {
    await expectRefused(
      extractText(Buffer.from('  \r\n\n  '), 'blank.txt'),
      IntakeErrorCodes.NO_TEXT,
      422
    );
  });

  it('refuses text over 40,000 characters rather than truncating it', async () => {
    expect(MAX_TEXT_CHARS).toBe(40_000);
    const err = await expectRefused(
      extractText(Buffer.from('a'.repeat(MAX_TEXT_CHARS + 1)), 'long.txt'),
      IntakeErrorCodes.TEXT_TOO_LONG,
      422
    );
    expect(err.details).toEqual({ chars: 40_001, maxChars: 40_000 });
  });

  it('accepts text of exactly 40,000 characters', async () => {
    const r = await extractText(Buffer.from('a'.repeat(MAX_TEXT_CHARS)), 'long.txt');
    expect(r.text).toHaveLength(MAX_TEXT_CHARS);
  });

  it('applies the character cap to extracted text, not file size', async () => {
    await expectRefused(
      extractText(fixture('deck.pptx'), 'deck.pptx', { maxChars: 100 }),
      IntakeErrorCodes.TEXT_TOO_LONG,
      422
    );
  });

  it.each(['deck.pptx', 'letter.docx', 'report.pdf'])(
    'refuses bytes that are not really a %s as unreadable',
    async (name) => {
      await expectRefused(
        extractText(Buffer.from('this is not that kind of file'), name),
        IntakeErrorCodes.UNREADABLE,
        422
      );
    }
  );
});
