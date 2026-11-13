/**
 * extractPptx (t-15): the cases a real deck fixture cannot cheaply carry,
 * built as minimal zips here — the expanded-size cap, chrome placeholders,
 * tables, line breaks, a missing presentation part, and a title taken from
 * the first slide when the deck has none.
 *
 * @see lib/app/intake/pptx.ts
 */

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { extractPptx } from '@/lib/app/intake/pptx';
import { IntakeError, IntakeErrorCodes } from '@/lib/app/intake/errors';

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';

const LIMITS = { maxSlides: 100, maxXmlBytes: 1_000_000 };

const shape = (body: string, ph?: string): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/><p:nvPr>${
    ph ? `<p:ph type="${ph}"/>` : ''
  }</p:nvPr></p:nvSpPr><p:txBody>${body}</p:txBody></p:sp>`;
const para = (inner: string): string => `<a:p>${inner}</a:p>`;
const run = (t: string): string => `<a:r><a:t>${t}</a:t></a:r>`;

async function deck(slides: string[], extra: Record<string, string> = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation ${NS}><p:sldIdLst>${slides
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`)
      .join('')}</p:sldIdLst></p:presentation>`
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships xmlns="${REL_NS}">${slides
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="${SLIDE_REL}" Target="slides/slide${i + 1}.xml"/>`
      )
      .join('')}</Relationships>`
  );
  slides.forEach((body, i) =>
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<p:sld ${NS}><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
    )
  );
  for (const [path, content] of Object.entries(extra)) zip.file(path, content);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('extractPptx', () => {
  it('drops slide numbers, dates and footers but keeps body text', async () => {
    const buf = await deck([
      shape(para(run('Pricing')), 'title') +
        shape(para(run('Three tiers.'))) +
        shape(para(run('7')), 'sldNum') +
        shape(para(run('13/11/2026')), 'dt') +
        shape(para(run('Confidential')), 'ftr'),
    ]);

    const r = await extractPptx(buf, LIMITS);

    expect(r.text).toBe('Pricing\nThree tiers.');
  });

  it('keeps line breaks inside a paragraph and text in tables', async () => {
    const table =
      '<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody>' +
      para(run('Cell A')) +
      '</a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
    const buf = await deck([shape(para(`${run('Line one')}<a:br/>${run('line two')}`)) + table]);

    const r = await extractPptx(buf, LIMITS);

    expect(r.text).toBe('Line one\nline two\nCell A');
  });

  it("takes the first slide's title when the deck has no title of its own", async () => {
    const buf = await deck([shape(para(run('Opening')), 'ctrTitle')]);

    const r = await extractPptx(buf, LIMITS);

    expect(r.title).toBe('Opening');
  });

  it('stops reading once the expanded XML passes the cap', async () => {
    // Compresses to almost nothing, expands well past the cap.
    const buf = await deck([shape(para(run('x'.repeat(200_000))))]);
    expect(buf.length).toBeLessThan(5_000);

    const err = await extractPptx(buf, { maxSlides: 10, maxXmlBytes: 50_000 }).catch(
      (e: unknown) => e
    );

    expect(err).toBeInstanceOf(IntakeError);
    expect((err as IntakeError).code).toBe(IntakeErrorCodes.TOO_LARGE);
  });

  it('refuses a zip that is not a presentation', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document/>');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });

    const err = await extractPptx(buf, LIMITS).catch((e: unknown) => e);

    expect((err as IntakeError).code).toBe(IntakeErrorCodes.UNREADABLE);
  });

  it('refuses malformed slide XML as unreadable', async () => {
    const buf = await deck(['<p:sp><unclosed>']);

    const err = await extractPptx(buf, LIMITS).catch((e: unknown) => e);

    expect((err as IntakeError).code).toBe(IntakeErrorCodes.UNREADABLE);
  });
});
