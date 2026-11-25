/**
 * Tests: reading a draft's gaps (t-83).
 *
 * @see lib/app/frameworks/placeholders.ts
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_PLACEHOLDER_LABEL,
  MAX_PLACEHOLDERS,
  parsePlaceholders,
  placeholderText,
} from '@/lib/app/frameworks/placeholders';

describe('parsePlaceholders', () => {
  it('reads each [ADD: …] with its label and where it sits, in order', () => {
    const draft = `We helped [ADD: a customer like Sarah's] save [ADD: how much] in a year.`;
    const got = parsePlaceholders(draft);
    expect(got.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'p1', label: "a customer like Sarah's" },
      { id: 'p2', label: 'how much' },
    ]);
    // Where each sits is the placeholder's own text in the draft.
    expect(got.map((p) => draft.slice(p.at[0].start, p.at[0].end))).toEqual([
      "[ADD: a customer like Sarah's]",
      '[ADD: how much]',
    ]);
  });

  it('reads the form the prompt asks for', () => {
    expect(parsePlaceholders(`x ${placeholderText('a number')} y`)[0].label).toBe('a number');
  });

  it('gives a fact written twice one field, sitting in both places', () => {
    const draft = '[ADD: client name] said so. Ask [add:  Client   Name ] yourself.';
    const got = parsePlaceholders(draft);
    expect(got).toHaveLength(1);
    expect(got[0].label).toBe('client name');
    expect(got[0].at.map((a) => draft.slice(a.start, a.end))).toEqual([
      '[ADD: client name]',
      '[add:  Client   Name ]',
    ]);
  });

  it('numbers by first appearance, so a growing draft never renumbers one', () => {
    const early = 'A [ADD: one] and B [ADD: tw';
    const later = 'A [ADD: one] and B [ADD: two] and [ADD: one] again.';
    expect(parsePlaceholders(early).map((p) => [p.id, p.label])).toEqual([['p1', 'one']]);
    expect(parsePlaceholders(later).map((p) => [p.id, p.label])).toEqual([
      ['p1', 'one'],
      ['p2', 'two'],
    ]);
  });

  it('passes over malformed ones, leaving them in the draft', () => {
    const draft = [
      '[ADD: unclosed',
      '[ADD:]',
      '[ADD:    ]',
      '[ADD: across\na line]',
      '[ADD: nested [brackets] here]',
      `[ADD: ${'x'.repeat(MAX_PLACEHOLDER_LABEL + 1)}]`,
      '[placeholder in square brackets]',
      '[a link](https://example.com)',
      'a citation [1]',
      '[ ADD: a space before ADD ]',
    ].join(' ');
    expect(parsePlaceholders(draft)).toEqual([]);
  });

  it('reads a label as long as the limit, and tidies its spacing', () => {
    const long = 'x'.repeat(MAX_PLACEHOLDER_LABEL);
    expect(parsePlaceholders(`[ADD: ${long}]`)[0].label).toBe(long);
    expect(parsePlaceholders('[ADD:\tthe   price\t]')[0].label).toBe('the price');
  });

  it('trims whitespace the pattern does not, so a blank one is passed over and repeats merge', () => {
    expect(parsePlaceholders('[ADD:\u00a0]')).toEqual([]);
    const got = parsePlaceholders('[ADD: client name\r] and [ADD: client name]');
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ label: 'client name' });
    expect(got[0].at).toHaveLength(2);
  });

  it(`offers at most ${MAX_PLACEHOLDERS}, still placing repeats of those it offers`, () => {
    const many = Array.from({ length: MAX_PLACEHOLDERS + 2 }, (_, i) => `[ADD: fact ${i}]`);
    const draft = `${many.join(' ')} [ADD: fact 0]`;
    const got = parsePlaceholders(draft);
    expect(got).toHaveLength(MAX_PLACEHOLDERS);
    expect(got.at(-1)?.label).toBe(`fact ${MAX_PLACEHOLDERS - 1}`);
    expect(got[0].at).toHaveLength(2);
  });

  it('finds none in a draft without any', () => {
    expect(parsePlaceholders('')).toEqual([]);
    expect(parsePlaceholders('Plain copy, no gaps.')).toEqual([]);
  });
});
