/**
 * Tests: the words around the model's records (t-63). Everything a later
 * version adds that this file does not list still gets a readable name.
 *
 * @see components/app/model/presentation.ts
 */
import { describe, expect, it } from 'vitest';
import {
  fieldLabel,
  kindLabel,
  readingOrder,
  sectionCopy,
} from '@/components/app/model/presentation';

describe('fallbacks for what the file does not list', () => {
  it('names an unknown section, kind and field from its key', () => {
    expect(sectionCopy('tone_profiles')).toEqual({ title: 'Tone profiles' });
    expect(kindLabel('knowledge_podcast')).toBe('Podcast');
    expect(kindLabel('knowledge_podcast', 'many')).toBe('Podcasts');
    expect(kindLabel('culture_norms', 'many')).toBe('Norms');
    expect(fieldLabel('reading_age')).toBe('Reading age');
    expect(fieldLabel('')).toBe('');
  });

  it('uses the listed words where there are some', () => {
    expect(sectionCopy('content_types').title).toBe('Types of copy');
    expect(kindLabel('judge', 'many')).toBe('AI reviewers');
    expect(fieldLabel('judge_asks')).toBe('The AI reviewer asks');
  });
});

describe('readingOrder', () => {
  it('puts listed fields first, then text, lists, maps and numbers, each alphabetically', () => {
    const order = readingOrder<unknown>([
      ['weight', 1],
      ['zeta', 'text'],
      ['map', { a: 1 }],
      ['alpha', 'text'],
      ['items', ['x']],
      ['rubric', { 0: 'none' }],
      ['description', 'lead'],
    ]).map(([key]) => key);
    expect(order).toEqual(['description', 'rubric', 'alpha', 'zeta', 'items', 'map', 'weight']);
  });
});

describe('section records', () => {
  it('are named after their section', () => {
    expect(kindLabel('section:scoring')).toBe('Scoring');
    expect(kindLabel('section:new_part')).toBe('New part');
  });
});
