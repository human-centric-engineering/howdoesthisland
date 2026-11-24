// @vitest-environment happy-dom

/**
 * The empty desk on /home: a labelled section that says what will appear, and
 * a way to `/assess` (t-79), now that there is one.
 *
 * @see components/app/shell/home-empty-state.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { HomeEmptyState } from '@/components/app/shell/home-empty-state';

describe('HomeEmptyState', () => {
  it('is a region named by its heading', () => {
    render(<HomeEmptyState />);
    const region = screen.getByRole('region', { name: 'Nothing on the desk yet.' });
    expect(within(region).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Nothing on the desk yet.'
    );
  });

  it('says what will appear here', () => {
    render(<HomeEmptyState />);
    expect(screen.getByText(/recent reviews will appear here/)).toBeInTheDocument();
  });

  it('offers one way on: to /assess', () => {
    render(<HomeEmptyState />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Review some copy' })).toHaveAttribute(
      'href',
      '/assess'
    );
  });

  it('keeps the line numbers out of the accessibility tree', () => {
    const { container } = render(<HomeEmptyState />);
    const gutter = container.querySelector('[aria-hidden="true"]');
    expect(gutter?.textContent).toBe('010203040506');
  });
});
