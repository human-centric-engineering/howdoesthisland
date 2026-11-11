// @vitest-environment happy-dom

/**
 * /home — the signed-in landing (D22). Until b2 fills it, it is the empty desk.
 *
 * The proxy only checks that a session cookie exists and sends anyone holding
 * one here from /login, so a stale cookie must be cleared here or that person
 * is locked out of the login form.
 *
 * @see app/(protected)/home/page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { getServerSession, clearInvalidSession } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  clearInvalidSession: vi.fn((returnUrl: string) => {
    throw new Error(`NEXT_REDIRECT ${returnUrl}`);
  }),
}));

vi.mock('@/lib/auth/utils', () => ({ getServerSession }));
vi.mock('@/lib/auth/clear-session', () => ({ clearInvalidSession }));

import HomePage, { metadata } from '@/app/(protected)/home/page';

beforeEach(() => {
  getServerSession.mockReset();
  clearInvalidSession.mockClear();
});

describe('/home', () => {
  it('is titled Home', () => {
    expect(metadata.title).toBe('Home');
  });

  it('renders the empty state for a live session', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } });
    render(await HomePage());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Nothing on the desk yet.');
    expect(clearInvalidSession).not.toHaveBeenCalled();
  });

  it('clears a cookie whose session is gone, returning to /home after login', async () => {
    getServerSession.mockResolvedValue(null);
    await expect(HomePage()).rejects.toThrow('NEXT_REDIRECT /home');
    expect(clearInvalidSession).toHaveBeenCalledWith('/home');
  });
});
