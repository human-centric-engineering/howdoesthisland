/**
 * Tests: how a review's context lays over its project's defaults (t-70).
 *
 * @see lib/app/projects/service.ts mergeContext
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ prisma: {} }));

import { mergeContext } from '@/lib/app/projects/service';

describe('mergeContext', () => {
  it('lets the request win field by field, keeping the project’s other fields', () => {
    expect(
      mergeContext({ contentType: 'landing_page', archetype: 'auditor' }, { archetype: 'builder' })
    ).toEqual({ contentType: 'landing_page', archetype: 'builder' });
  });

  it('merges an object both give key by key, so one audience option keeps the rest', () => {
    expect(
      mergeContext(
        { audience: { awareness: 'solution_aware', relationship: 'cold' } },
        { audience: { relationship: 'warm' } }
      )
    ).toEqual({ audience: { awareness: 'solution_aware', relationship: 'warm' } });
  });

  it('lets an empty string from the request clear the project’s value (no role)', () => {
    expect(mergeContext({ role: 'cfo' }, { role: '' })).toEqual({ role: '' });
  });

  it('takes the request’s value whole when only one side is an object', () => {
    expect(mergeContext({ audience: 'odd' }, { audience: { focus: 'promotion' } })).toEqual({
      audience: { focus: 'promotion' },
    });
    expect(mergeContext({ culture: { reader: 'gb' } }, { culture: ['x'] })).toEqual({
      culture: ['x'],
    });
  });

  it('answers either side alone when the other is missing, and changes neither', () => {
    const project = { audience: { awareness: 'unaware' } };
    const request = { contentType: 'cv_resume' };

    expect(mergeContext(undefined, request)).toBe(request);
    expect(mergeContext(project, undefined)).toEqual(project);
    expect(mergeContext(undefined, undefined)).toBeUndefined();

    mergeContext(project, { audience: { awareness: 'most_aware' } });
    expect(project).toEqual({ audience: { awareness: 'unaware' } });
  });
});
