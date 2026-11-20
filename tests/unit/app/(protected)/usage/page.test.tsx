// @vitest-environment happy-dom

/**
 * /usage (t-48) — the workspace's usage this month, read through the API.
 *
 * Mocked: the session read, the stale-cookie clear and the API load. The
 * figures themselves are `UsageSummary`'s, tested beside it.
 *
 * @see app/(protected)/usage/page.tsx
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { getServerSession, clearInvalidSession, requireServerData } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  clearInvalidSession: vi.fn((returnUrl: string) => {
    throw new Error(`NEXT_REDIRECT ${returnUrl}`);
  }),
  requireServerData: vi.fn(),
}));

vi.mock('@/lib/auth/utils', () => ({ getServerSession }));
vi.mock('@/lib/auth/clear-session', () => ({ clearInvalidSession }));
vi.mock('@/lib/api/server-load', () => ({ requireServerData }));

import UsagePage, { metadata } from '@/app/(protected)/usage/page';

const USAGE = {
  month: { start: '2026-11-01T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z' },
  reviews: 1,
  calls: 4,
  spendUsd: 0.4,
  cap: { limitUsd: 10, remainingUsd: 9.6, exceeded: false },
  credits: { balance: 250, spentThisMonth: 0 },
  lines: [{ kind: 'no-project', projectId: null, reviews: 1, calls: 4, spendUsd: 0.4 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } });
  requireServerData.mockResolvedValue({ data: USAGE });
});

describe('/usage', () => {
  it('is titled Usage', () => {
    expect(metadata.title).toBe('Usage');
  });

  it('renders what GET /api/v1/usage answers', async () => {
    render(await UsagePage());

    expect(requireServerData).toHaveBeenCalledWith('/api/v1/usage');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('November 2026');
    expect(screen.getByRole('region', { name: 'Monthly spending limit' })).toHaveTextContent(
      '$0.40 of $10.00 spent'
    );
    expect(screen.getByRole('region', { name: 'CopyCredits' })).toHaveTextContent('250');
  });

  it('refuses an answer that is not the usage shape, rather than rendering it', async () => {
    requireServerData.mockResolvedValue({ data: { reviews: 'many' } });

    await expect(UsagePage()).rejects.toThrow();
  });

  it('clears a cookie whose session is gone, returning to /usage after login', async () => {
    getServerSession.mockResolvedValue(null);

    await expect(UsagePage()).rejects.toThrow('NEXT_REDIRECT /usage');
    expect(clearInvalidSession).toHaveBeenCalledWith('/usage');
    expect(requireServerData).not.toHaveBeenCalled();
  });
});
