// @vitest-environment happy-dom

/**
 * The empty desk on /home: a labelled section that says what will appear, and
 * no link, because nothing it could link to exists yet.
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
    expect(
      screen.getByText(/recent assessments and projects will appear here/)
    ).toBeInTheDocument();
  });

  it('offers no link, so nothing on it can 404', () => {
    render(<HomeEmptyState />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('keeps the line numbers out of the accessibility tree', () => {
    const { container } = render(<HomeEmptyState />);
    const gutter = container.querySelector('[aria-hidden="true"]');
    expect(gutter?.textContent).toBe('010203040506');
  });
});
