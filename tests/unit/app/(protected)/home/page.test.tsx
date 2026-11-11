// @vitest-environment happy-dom

/**
 * /home — the signed-in landing (D22). Until b2 fills it, it is the empty desk.
 *
 * @see app/(protected)/home/page.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage, { metadata } from '@/app/(protected)/home/page';

describe('/home', () => {
  it('is titled Home', () => {
    expect(metadata.title).toBe('Home');
  });

  it('renders the empty state', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Nothing on the desk yet.');
  });
});
