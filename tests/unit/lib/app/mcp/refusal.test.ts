/**
 * A library refusal as a tool answer (t-92): the library's own words, with the
 * fields a validation error names, and nothing else turned into a refusal.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ prisma: {} }));

import { APIError, ValidationError } from '@/lib/api/errors';
import { WorkspaceBusyError } from '@/lib/app/assessments/places';
import { refusalOf } from '@/lib/app/mcp/run/refusal';

describe('refusalOf', () => {
  it('answers a busy workspace with its own message', () => {
    const busy = new WorkspaceBusyError(null);
    expect(refusalOf(busy)).toEqual({ code: 'WORKSPACE_BUSY', message: busy.message });
  });

  it('answers an APIError with no code as REFUSED', () => {
    expect(refusalOf(new APIError('No.', undefined, 409))).toEqual({
      code: 'REFUSED',
      message: 'No.',
    });
  });

  it('names each field a validation error lists, skipping what it cannot read', () => {
    const err = new ValidationError('Invalid', {
      errors: [
        { path: 'text', message: 'Too long' },
        { path: '', message: 'Give text or a url' },
        { message: 'No path at all' },
        { path: 'url' },
        'not an object',
        null,
      ],
    });

    expect(refusalOf(err)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid: text: Too long; Give text or a url; No path at all',
    });
  });

  it('names each field a context refusal lists under issues', () => {
    const err = new APIError(
      'The context does not fit this framework version.',
      'CONTEXT_INVALID',
      400,
      {
        issues: [{ path: 'contentType', message: 'Unknown value "landing"' }],
      }
    );

    expect(refusalOf(err)).toEqual({
      code: 'CONTEXT_INVALID',
      message:
        'The context does not fit this framework version: contentType: Unknown value "landing"',
    });
  });

  it('keeps the message as it is when details carry no list', () => {
    expect(refusalOf(new ValidationError('Invalid', { errors: 'nope' }))).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid',
    });
  });

  it('leaves anything else to be thrown', () => {
    expect(refusalOf(new Error('connection reset'))).toBeNull();
    expect(refusalOf('a string')).toBeNull();
  });

  it('ignores a position that is not a draft’s place (t-93)', () => {
    for (const position of [-1, 1.5, '2', null]) {
      expect(
        refusalOf(new APIError('No.', 'REFUSED', 409, { position, differs: ['project'] }))?.message
      ).toBe('No.');
    }
  });

  it('names the draft and keeps only the field names it can read (t-93)', () => {
    expect(
      refusalOf(new APIError('No.', 'REFUSED', 409, { position: 0, differs: ['version', 3] }))
        ?.message
    ).toBe('The draft at position 0: No. It differs in: version.');
  });
});
