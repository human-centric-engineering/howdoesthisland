/**
 * Tests: what `POST /api/v1/rewrites` accepts, for answers to an earlier
 * rewrite's placeholders (t-83).
 *
 * @see lib/app/rewrites/validations.ts
 */
import { describe, expect, it } from 'vitest';
import { MAX_PLACEHOLDERS } from '@/lib/app/frameworks/placeholders';
import { createRewriteSchema, MAX_ANSWER_CHARS } from '@/lib/app/rewrites/validations';

const base = { assessmentId: 'asm_1' };

describe('createRewriteSchema: answers', () => {
  it('takes answers with the rewrite they answer, trimmed', () => {
    expect(
      createRewriteSchema.parse({ ...base, fromRewriteId: 'rw_1', answers: { p1: '  Leeds  ' } })
    ).toEqual({ ...base, stream: false, fromRewriteId: 'rw_1', answers: { p1: 'Leeds' } });
  });

  it('takes neither, as before', () => {
    expect(createRewriteSchema.parse(base)).toEqual({ ...base, stream: false });
  });

  it('refuses one without the other', () => {
    expect(createRewriteSchema.safeParse({ ...base, fromRewriteId: 'rw_1' }).success).toBe(false);
    expect(createRewriteSchema.safeParse({ ...base, answers: { p1: 'x' } }).success).toBe(false);
  });

  it('refuses no answers, a blank one, and one past the limit', () => {
    const withAnswers = (answers: Record<string, string>) =>
      createRewriteSchema.safeParse({ ...base, fromRewriteId: 'rw_1', answers }).success;
    expect(withAnswers({})).toBe(false);
    expect(withAnswers({ p1: '   ' })).toBe(false);
    expect(withAnswers({ p1: 'x'.repeat(MAX_ANSWER_CHARS + 1) })).toBe(false);
    expect(withAnswers({ p1: 'x'.repeat(MAX_ANSWER_CHARS) })).toBe(true);
  });

  it(`refuses more than ${MAX_PLACEHOLDERS} answers`, () => {
    const answers = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i + 1}`, 'x']));
    const ok = (n: number) =>
      createRewriteSchema.safeParse({ ...base, fromRewriteId: 'rw_1', answers: answers(n) })
        .success;
    expect(ok(MAX_PLACEHOLDERS)).toBe(true);
    expect(ok(MAX_PLACEHOLDERS + 1)).toBe(false);
  });
});
