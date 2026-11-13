/**
 * PowerPoint text extraction (t-15): slide text and speaker notes, in the
 * order the deck is presented.
 *
 * Core's `parseDocument()` has no PPTX parser. A deck is a zip of XML parts,
 * so this needs only `jszip` (to open it) and an XML parser (jsdom's, already
 * a direct dependency for the HTML parser).
 *
 * **Order comes from `ppt/presentation.xml`, not from file names.** A slide's
 * part name (`slide3.xml`) is fixed when the slide is created and never
 * changes when it is moved, so numeric file order is creation order. The
 * presented order is `<p:sldIdLst>`, each entry naming a relationship in
 * `ppt/_rels/presentation.xml.rels`. A slide's notes are found the same way,
 * through the slide's own relationships, never by matching numbers.
 *
 * **Hidden slides are skipped** (`show="0"`): they are not part of what an
 * audience sees. The count skipped comes back as a warning.
 *
 * **Expanded size is capped.** A small zip can inflate to gigabytes, so every
 * part is read as a stream and the read stops once the parts together pass
 * `maxXmlBytes`. Media is never read.
 */

import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { IntakeError, IntakeErrorCodes } from '@/lib/app/intake/errors';

export interface PptxLimits {
  /** Most slides read; a deck listing more is refused. */
  maxSlides: number;
  /** Most bytes of XML read once decompressed, across every part. */
  maxXmlBytes: number;
}

export interface PptxText {
  /** Visible slides in presented order: each slide's text, then its notes. */
  text: string;
  /** `docProps/core.xml` title, else the first visible slide's title. Empty when neither. */
  title: string;
  /** Slides the deck lists, hidden ones included. */
  slideCount: number;
  warnings: string[];
}

/** Placeholders whose text is chrome, not content. */
const CHROME_PLACEHOLDERS = new Set(['sldNum', 'dt', 'ftr', 'hdr', 'sldImg']);
const TITLE_PLACEHOLDERS = new Set(['title', 'ctrTitle']);

/** Transitional and Strict OOXML name the same elements in different namespaces. */
const isNs = (el: Element, kind: 'drawingml' | 'presentationml'): boolean => {
  const ns = el.namespaceURI ?? '';
  return (
    ns === `http://schemas.openxmlformats.org/${kind}/2006/main` ||
    ns === `http://purl.oclc.org/ooxml/${kind}/main`
  );
};

const RELATIONSHIP_NS = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
]);

interface ReadBudget {
  used: number;
  readonly max: number;
}

function tooLarge(max: number): IntakeError {
  return new IntakeError(
    IntakeErrorCodes.TOO_LARGE,
    `This presentation expands to more than ${Math.round(max / 1_048_576)} MB of slide text, more than we read.`,
    { maxXmlBytes: max }
  );
}

/** Reads one part as UTF-8, charging its decompressed size to the budget. */
async function readPart(zip: JSZip, path: string, budget: ReadBudget): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = file.nodeStream('nodebuffer');
    let settled = false;
    const fail = (err: unknown): void => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    stream.on('data', (chunk: Buffer) => {
      if (settled) return;
      budget.used += chunk.length;
      if (budget.used > budget.max) {
        settled = true;
        stream.pause();
        reject(tooLarge(budget.max));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', fail);
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

type XmlParser = (xml: string, path: string) => Document;

function makeParser(): XmlParser {
  const { DOMParser } = new JSDOM('').window;
  const parser = new DOMParser();
  return (xml, path) => {
    const doc = parser.parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new Error(`malformed XML in ${path}`);
    }
    return doc;
  };
}

/**
 * A relationship target resolved against the part that declares it: relative
 * to that part's folder, or from the package root when it starts with `/`.
 * (No `path`: Node-only, barred from `lib/app/**`.)
 */
function resolvePart(fromPart: string, target: string): string {
  const parts = target.startsWith('/') ? [] : fromPart.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** Where a part's relationships live: `dir/_rels/name.rels`. */
function relsPathOf(partPath: string): string {
  const i = partPath.lastIndexOf('/');
  return i < 0
    ? `_rels/${partPath}.rels`
    : `${partPath.slice(0, i)}/_rels/${partPath.slice(i + 1)}.rels`;
}

/** Relationship id → resolved part path, for the part at `partPath`. */
function readRels(doc: Document, partPath: string): Map<string, { type: string; path: string }> {
  const rels = new Map<string, { type: string; path: string }>();
  for (const rel of Array.from(doc.getElementsByTagNameNS('*', 'Relationship'))) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (!id || !target || rel.getAttribute('TargetMode') === 'External') continue;
    rels.set(id, { type: rel.getAttribute('Type') ?? '', path: resolvePart(partPath, target) });
  }
  return rels;
}

/** The placeholder type of the shape a paragraph sits in, if any. */
function placeholderType(p: Element): string | null {
  for (let el = p.parentElement; el; el = el.parentElement) {
    if (el.localName === 'sp' && isNs(el, 'presentationml')) {
      const ph = Array.from(el.getElementsByTagNameNS('*', 'ph')).find((x) =>
        isNs(x, 'presentationml')
      );
      // A placeholder with no type attribute is a body placeholder.
      return ph ? (ph.getAttribute('type') ?? 'body') : null;
    }
  }
  return null;
}

/** A paragraph's text: its runs and fields in order, line breaks kept. */
function paragraphText(p: Element): string {
  let out = '';
  const walk = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      if (!isNs(child, 'drawingml')) continue;
      if (child.localName === 't') out += child.textContent ?? '';
      else if (child.localName === 'br') out += '\n';
      else walk(child);
    }
  };
  walk(p);
  return out.trim();
}

interface PartText {
  paragraphs: string[];
  title: string;
}

function partText(doc: Document): PartText {
  const paragraphs: string[] = [];
  let title = '';
  for (const p of Array.from(doc.getElementsByTagNameNS('*', 'p'))) {
    if (!isNs(p, 'drawingml')) continue;
    const type = placeholderType(p);
    if (type && CHROME_PLACEHOLDERS.has(type)) continue;
    const text = paragraphText(p);
    if (!text) continue;
    if (!title && type && TITLE_PLACEHOLDERS.has(type)) title = text;
    paragraphs.push(text);
  }
  return { paragraphs, title };
}

function unreadable(reason: string): IntakeError {
  return new IntakeError(
    IntakeErrorCodes.UNREADABLE,
    'This file could not be read as a PowerPoint presentation.',
    { reason }
  );
}

export async function extractPptx(buffer: Buffer, limits: PptxLimits): Promise<PptxText> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    throw unreadable(err instanceof Error ? err.message : 'not a zip archive');
  }

  const budget: ReadBudget = { used: 0, max: limits.maxXmlBytes };
  const parse = makeParser();
  const read = async (path: string): Promise<Document | null> => {
    const xml = await readPart(zip, path, budget);
    return xml === null ? null : parse(xml, path);
  };

  try {
    const presPath = 'ppt/presentation.xml';
    const pres = await read(presPath);
    const presRels = await read(relsPathOf(presPath));
    if (!pres || !presRels) throw unreadable('no ppt/presentation.xml');
    const rels = readRels(presRels, presPath);

    const slidePaths: string[] = [];
    for (const sldId of Array.from(pres.getElementsByTagNameNS('*', 'sldId'))) {
      const rid = Array.from(sldId.attributes).find(
        (a) => a.localName === 'id' && RELATIONSHIP_NS.has(a.namespaceURI ?? '')
      )?.value;
      const rel = rid ? rels.get(rid) : undefined;
      if (rel) slidePaths.push(rel.path);
    }

    if (slidePaths.length > limits.maxSlides) {
      throw new IntakeError(
        IntakeErrorCodes.TOO_MANY_PAGES,
        `This presentation has ${slidePaths.length} slides; we read up to ${limits.maxSlides}.`,
        { slides: slidePaths.length, maxSlides: limits.maxSlides }
      );
    }

    const blocks: string[] = [];
    let firstTitle = '';
    let hidden = 0;
    for (const slidePath of slidePaths) {
      const slide = await read(slidePath);
      if (!slide) continue;
      if (slide.documentElement.getAttribute('show') === '0') {
        hidden++;
        continue;
      }
      const { paragraphs, title } = partText(slide);
      if (!firstTitle) firstTitle = title;

      const slideRels = await read(relsPathOf(slidePath));
      const notesRel = slideRels
        ? Array.from(readRels(slideRels, slidePath).values()).find((r) =>
            r.type.endsWith('/notesSlide')
          )
        : undefined;
      const notes = notesRel ? await read(notesRel.path) : null;
      const notesParagraphs = notes ? partText(notes).paragraphs : [];

      const block = [paragraphs.join('\n'), notesParagraphs.join('\n')]
        .filter(Boolean)
        .join('\n\n');
      if (block) blocks.push(block);
    }

    const core = await read('docProps/core.xml');
    const coreTitle =
      core?.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0]?.textContent ??
      '';

    const warnings: string[] = [];
    if (hidden > 0) {
      warnings.push(
        `Skipped ${hidden} hidden slide${hidden === 1 ? '' : 's'}: they are not shown to an audience.`
      );
    }

    return {
      text: blocks.join('\n\n'),
      title: coreTitle.trim() || firstTitle,
      slideCount: slidePaths.length,
      warnings,
    };
  } catch (err) {
    if (err instanceof IntakeError) throw err;
    throw unreadable(err instanceof Error ? err.message : 'unreadable part');
  }
}
