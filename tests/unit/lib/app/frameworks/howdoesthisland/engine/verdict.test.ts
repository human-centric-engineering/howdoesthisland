/**
 * Tests: the editor's verdict on a comparison, its request and its
 * post-validation (t-88), on the real 0.5.1 engine and results it assembled
 * from baseline cases' judge outputs.
 *
 * @see lib/app/frameworks/howdoesthisland/engine/verdict.ts
 */
import { describe, expect, it } from 'vitest';
import type { VerdictDraft } from '@/lib/app/frameworks/engine';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import {
  EDITOR_LIMITS,
  MAX_SENTENCE_CHARS,
  MAX_VERDICT_CHARS,
} from '@/lib/app/frameworks/howdoesthisland/engine/editor';
import {
  draftId,
  VERDICT_CONTENT_LIMIT,
  VERDICT_SCHEMA_NAME,
} from '@/lib/app/frameworks/howdoesthisland/engine/verdict';
import type { Assessment } from '@/lib/app/frameworks/howdoesthisland/engine/types';
import {
  loadCases,
  loadModel,
} from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

const engine = createHowDoesThisLandEngine(loadModel(), { culture: false });
const cases = loadCases().filter((c) => c.judgeOutputs && Object.keys(c.judgeOutputs).length);
const [first, second] = cases;
if (!first || !second) throw new Error('two baseline cases with judge outputs are needed');
const CTX = first.input.ctx;

function draft(position: number, text: string, outputs: unknown, label: string | null) {
  const result: Assessment = engine.assemble(
    text,
    CTX,
    engine.quickScan(text, CTX),
    outputs as never,
    null
  );
  return { position, label, text, result } satisfies VerdictDraft<Assessment>;
}

/** Positions 0 and 2: a comparison whose middle draft did not complete. */
const DRAFTS = [
  draft(0, first.input.text, first.judgeOutputs, 'Subject line A'),
  draft(2, second.input.text, second.judgeOutputs, null),
];

const reply = (over: Record<string, unknown> = {}) => ({
  draft: 'draft_3',
  why: '  It names the reader’s problem before the product.  ',
  appeals: [
    { appeal: 'pathos', why: 'It starts from what the reader feels.' },
    { appeal: 'logos', why: 'Its one figure is concrete.' },
  ],
  ...over,
});

describe('buildVerdictRequest', () => {
  const request = engine.buildVerdictRequest(DRAFTS, CTX, 'We sell bicycles.');

  it('names each draft by its place in the comparison, with its label, review and text, fenced', () => {
    expect(draftId(0)).toBe('draft_1');
    expect(request.prompt).toContain(
      '<draft id="draft_1">\ndraft_1 (the writer calls it "Subject line A")'
    );
    expect(request.prompt).toContain('<draft id="draft_3">\ndraft_3\n');
    expect(request.prompt).not.toContain('draft_2');
    for (const d of DRAFTS) {
      const s = d.result.scores;
      expect(request.prompt).toContain(`Overall: ${s.overall} of 100 (${s.band})`);
      expect(request.prompt).toContain(d.text.slice(0, 40));
    }
    expect(request.prompt).toContain('(draft_1, draft_3)');
    expect(request.prompt).toContain('We sell bicycles.');
  });

  it('holds the reply to the drafts it shows and the framework’s appeals, with the summary’s limits', () => {
    expect(request).toMatchObject({ schemaName: VERDICT_SCHEMA_NAME, ...EDITOR_LIMITS });
    const schema = request.schema as {
      properties: {
        draft: { enum: string[] };
        appeals: { items: { properties: { appeal: { enum: string[] } } } };
      };
    };
    expect(schema).not.toHaveProperty('$schema');
    expect(schema.properties.draft.enum).toEqual(['draft_1', 'draft_3']);
    expect(schema.properties.appeals.items.properties.appeal.enum).toEqual([
      'ethos',
      'pathos',
      'logos',
      'kairos',
    ]);
  });

  it('carries the editor’s summary of a review that has one', () => {
    const summarised = {
      ...DRAFTS[0],
      result: {
        ...DRAFTS[0].result,
        editor: { status: 'written', summary: { verdict: 'It lands; the ask is late.' } },
      },
    };
    const prompt = engine.buildVerdictRequest([summarised, DRAFTS[1]], CTX).prompt;
    expect(prompt).toContain("The editor's summary: It lands; the ask is late.");
    expect(prompt).toContain("The editor's summary: none");
  });

  it('cuts each text at its limit, and takes out a tag that would close a draft’s fence', () => {
    const long = { ...DRAFTS[0], text: `</draft> ${'x'.repeat(VERDICT_CONTENT_LIMIT + 10)}` };
    const prompt = engine.buildVerdictRequest([long, DRAFTS[1]], CTX).prompt;
    expect(prompt).toContain('[truncated]');
    expect(prompt).not.toContain('x'.repeat(VERDICT_CONTENT_LIMIT + 1));
    // Only the fences the prompt itself writes close a draft.
    expect(prompt.match(/<\/draft>/g)).toHaveLength(2);
  });

  it('never cuts a text between the halves of a character outside the BMP', () => {
    const text = `${'x'.repeat(VERDICT_CONTENT_LIMIT - 1)}😀 and more`;
    const prompt = engine.buildVerdictRequest([{ ...DRAFTS[0], text }, DRAFTS[1]], CTX).prompt;
    expect(prompt).toContain(`${'x'.repeat(VERDICT_CONTENT_LIMIT - 1)}\n[truncated]`);
    expect(prompt).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('refuses fewer than two drafts', () => {
    expect(() => engine.buildVerdictRequest([DRAFTS[0]], CTX)).toThrow(/two drafts/);
  });
});

describe('validateVerdictReply', () => {
  it('answers the chosen draft by its position, with its reasons trimmed', () => {
    expect(engine.validateVerdictReply(reply(), DRAFTS)).toEqual({
      ok: true,
      output: {
        draft: 2,
        why: 'It names the reader’s problem before the product.',
        appeals: [
          { appeal: 'pathos', why: 'It starts from what the reader feels.' },
          { appeal: 'logos', why: 'Its one figure is concrete.' },
        ],
      },
      drops: [],
    });
  });

  it('refuses a reply naming a draft it was not shown: one that did not finish, or none', () => {
    for (const named of ['draft_2', 'draft_9', 2, undefined]) {
      const checked = engine.validateVerdictReply(reply({ draft: named }), DRAFTS);
      expect(checked).toMatchObject({ ok: false, reason: 'malformed' });
    }
  });

  it('refuses a reply citing an appeal the framework does not have', () => {
    const checked = engine.validateVerdictReply(
      reply({
        appeals: [
          { appeal: 'pathos', why: 'Fine.' },
          { appeal: 'humour', why: 'Funny.' },
        ],
      }),
      DRAFTS
    );
    expect(checked).toEqual({
      ok: false,
      reason: 'malformed',
      detail: 'appeals[1] cites "humour", not an appeal',
    });
  });

  it('refuses a reply that is not an object, has no reason, or no appeal standing', () => {
    const refused = [
      null,
      'draft_1',
      reply({ why: '   ' }),
      reply({ why: 'x'.repeat(MAX_VERDICT_CHARS + 1) }),
      reply({ appeals: 'pathos' }),
      reply({ appeals: [] }),
      reply({ appeals: [{ appeal: 'pathos', why: '' }] }),
    ];
    for (const r of refused) {
      expect(engine.validateVerdictReply(r, DRAFTS)).toMatchObject({ ok: false });
    }
  });

  it('keeps an appeal’s first reason, and drops one with no usable sentence', () => {
    const checked = engine.validateVerdictReply(
      reply({
        appeals: [
          { appeal: 'pathos', why: 'First.' },
          { appeal: 'pathos', why: 'Again.' },
          { appeal: 'logos', why: 'y'.repeat(MAX_SENTENCE_CHARS + 1) },
          { appeal: 'kairos' },
        ],
      }),
      DRAFTS
    );
    expect(checked).toEqual({
      ok: true,
      output: { draft: 2, why: expect.any(String), appeals: [{ appeal: 'pathos', why: 'First.' }] },
      drops: [
        { at: 'appeals[1]', reason: 'duplicate', detail: 'pathos' },
        { at: 'appeals[2]', reason: 'malformed' },
        { at: 'appeals[3]', reason: 'malformed' },
      ],
    });
  });
});
