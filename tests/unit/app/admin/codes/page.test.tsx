// @vitest-environment happy-dom

/**
 * Admin — review codes page (t-59): a thin shell over
 * `GET /api/v1/admin/codes`. Only `serverFetch` and the router are faked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/server-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/server-fetch')>()),
  serverFetch: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/codes',
}));

import CodesPage from '@/app/admin/codes/page';
import { serverFetch } from '@/lib/api/server-fetch';
import { ServerLoadError } from '@/lib/api/server-load';
import { apiFailure, apiSuccess } from '@/tests/helpers/api';

const CODE = {
  id: 'cmcode0000000000000000001',
  code: 'ABCDEFGHJKMN',
  link: 'https://app.test/redeem?code=ABCDEFGHJKMN',
  campaign: 'Spring stand card',
  creditsPerRedemption: 300,
  maxRedemptions: 25,
  redemptionsUsed: 0,
  redemptionsLeft: 25,
  status: 'active',
  expiresAt: '2027-02-19T23:59:59.999Z',
  revokedAt: null,
  createdAt: '2026-11-21T09:00:00.000Z',
};

const page = async (q?: string | string[]) =>
  render(await CodesPage({ searchParams: Promise.resolve(q === undefined ? {} : { q }) }));

beforeEach(() => vi.clearAllMocks());

describe('CodesPage', () => {
  it('renders the codes from the admin endpoint, with the form to make more', async () => {
    vi.mocked(serverFetch).mockResolvedValue(apiSuccess({ codes: [CODE], truncated: false }));
    await page();
    expect(vi.mocked(serverFetch).mock.calls[0]?.[0]).toBe('/api/v1/admin/codes');
    expect(screen.getByRole('heading', { level: 1, name: /Review codes/ })).toBeInTheDocument();
    expect(screen.getByText('ABCD-EFGH-JKMN')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Make review codes' })).toBeInTheDocument();
  });

  it('passes the search through, cut to what the route accepts', async () => {
    vi.mocked(serverFetch).mockResolvedValue(apiSuccess({ codes: [], truncated: false }));
    await page(['  spring  ', 'ignored']);
    expect(vi.mocked(serverFetch).mock.calls[0]?.[0]).toBe('/api/v1/admin/codes?q=spring');

    // A fresh answer: a Response's body is read once.
    vi.mocked(serverFetch).mockClear();
    vi.mocked(serverFetch).mockResolvedValue(apiSuccess({ codes: [], truncated: false }));
    await page('😀'.repeat(150));
    expect(vi.mocked(serverFetch).mock.calls[0]?.[0]).toBe(
      `/api/v1/admin/codes?q=${encodeURIComponent('😀'.repeat(100))}`
    );
  });

  it('refuses a body that is not the list, rather than rendering it', async () => {
    vi.mocked(serverFetch).mockResolvedValue(
      apiSuccess({ codes: [{ id: 'x' }], truncated: false })
    );
    await expect(CodesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow();
  });

  it('throws to the error boundary when the load fails', async () => {
    vi.mocked(serverFetch).mockResolvedValue(apiFailure(500));
    await expect(CodesPage({ searchParams: Promise.resolve({}) })).rejects.toBeInstanceOf(
      ServerLoadError
    );
  });
});
