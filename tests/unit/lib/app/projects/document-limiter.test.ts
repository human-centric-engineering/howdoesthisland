/**
 * Tests: the per-user sub-cap on adding project documents (t-74).
 *
 * @see lib/app/projects/document-limiter.ts
 */
import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_ADDS_PER_INTERVAL,
  documentAddLimiter,
} from '@/lib/app/projects/document-limiter';

describe('documentAddLimiter', () => {
  it('allows a person their adds in the window, refuses the next, and counts each person apart', () => {
    for (let i = 0; i < DOCUMENT_ADDS_PER_INTERVAL; i++) {
      expect(documentAddLimiter.check('user:limit-a').success).toBe(true);
    }

    expect(documentAddLimiter.check('user:limit-a').success).toBe(false);
    expect(documentAddLimiter.check('user:limit-b').success).toBe(true);
  });
});
