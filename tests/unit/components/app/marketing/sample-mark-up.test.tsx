// @vitest-environment happy-dom

/**
 * Tests: the landing hero's sample (t-69). It is the opening of the worked
 * example's first draft, with the reviewers' notes on it: both read from the
 * example, so the card and `/example-review` never disagree.
 *
 * @see components/app/marketing/sample-mark-up.tsx
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SampleMarkUp } from '@/components/app/marketing/sample-mark-up';
import { DRAFT, draftNote } from '@/lib/app/example/example-review';

describe('SampleMarkUp', () => {
  it('shows only lines of the example’s first draft, each marked one carrying its reviewer’s note', () => {
    const { container } = render(<SampleMarkUp href="/example-review" />);
    const marked = [...container.querySelectorAll('mark')].map((m) =>
      (m.firstChild?.textContent ?? '').trim()
    );
    expect(marked).toHaveLength(4);
    for (const line of marked) {
      expect(DRAFT).toContain(line);
      expect(container.textContent).toContain(draftNote(line));
    }
    // Every paragraph of the passage, note numbers aside, is in the draft.
    const passage = container.querySelectorAll('div.space-y-3 > p');
    expect(passage.length).toBeGreaterThan(1);
    const draft = DRAFT.replace(/\s+/g, ' ');
    for (const p of passage) {
      const text = [...p.childNodes]
        .map((n) => (n.nodeName === 'MARK' ? (n.firstChild?.textContent ?? '') : n.textContent))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      expect(draft).toContain(text);
    }
  });

  it('is one link, to the full example', () => {
    render(<SampleMarkUp href="/example-review" />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByTestId('sample-mark-up-link')).toHaveAttribute('href', '/example-review');
  });
});
