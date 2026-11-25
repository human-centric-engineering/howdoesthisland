/**
 * What a rewrite can work on (t-82).
 *
 * @see components/app/report/rewrite-focuses.ts
 */
import { describe, expect, it } from 'vitest';
import { BALANCED, rewriteFocuses } from '@/components/app/report/rewrite-focuses';

describe('rewriteFocuses', () => {
  it('offers balanced first, then each appeal, its help naming the appeal’s question', () => {
    const focuses = rewriteFocuses([{ id: 'ethos', name: 'Ethos', question: 'Do they trust it?' }]);
    expect(focuses.map((f) => [f.id, f.name])).toEqual([
      [BALANCED, 'Balanced'],
      ['ethos', 'Ethos'],
    ]);
    expect(focuses[1].help).toBe(
      'Raises Ethos without weakening the others, applying the recommendations about it. Ethos asks: Do they trust it?'
    );
  });

  it('leaves the question out of the help when the model gives none', () => {
    const [, kairos] = rewriteFocuses([{ id: 'kairos', name: 'kairos', question: '' }]);
    expect(kairos.help).toBe(
      'Raises kairos without weakening the others, applying the recommendations about it.'
    );
  });
});
