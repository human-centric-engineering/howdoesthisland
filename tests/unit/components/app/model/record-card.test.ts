/**
 * Tests: the titles a record's links use (t-63).
 *
 * @see components/app/model/record-card.tsx
 */
import { describe, expect, it } from 'vitest';
import type { BrowseRecord } from '@/lib/app/frameworks/browse';
import { recordTitle, shortTitle } from '@/components/app/model/record-card';

const record = (
  attributes: Record<string, unknown>,
  kind = 'research',
  id = 'r1'
): BrowseRecord => ({
  kind,
  id,
  section: 'research',
  anchor: 'r1',
  attributes,
  parentId: null,
  children: [],
});

describe('shortTitle', () => {
  it('keeps a short title whole', () => {
    expect(shortTitle(record({ name: 'Rule of three' }))).toBe('Rule of three');
  });

  it('cuts a long citation after its year', () => {
    const cite =
      "O'Keefe & Hoeken (2021). Message design choices don't make much difference to persuasiveness.";
    expect(shortTitle(record({ cite }))).toBe("O'Keefe & Hoeken (2021)");
  });

  it('cuts any other long title at a word, with an ellipsis, even with a bracket early on', () => {
    const name = 'Ethos (credibility) as the ground of every other appeal in persuasion, and more';
    expect(shortTitle(record({ name }))).toBe(
      'Ethos (credibility) as the ground of every other appeal in…'
    );
  });
});

describe('recordTitle', () => {
  it('names a section’s own record after the section, not its name field', () => {
    expect(recordTitle(record({ name: 'HowDoesThisLand' }, 'section:brand', 'brand'))).toBe(
      'Name and principles'
    );
  });

  it('falls back to the id', () => {
    expect(recordTitle(record({ value: 1 }))).toBe('r1');
  });
});
