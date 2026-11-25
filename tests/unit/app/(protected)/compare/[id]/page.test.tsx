// @vitest-environment happy-dom

/**
 * /compare/[id] — a comparison (t-89). The page signs the reader in, reads
 * the comparison through the one enriched API read, names the appeals from
 * the version's catalogue, and renders the comparison; the view has its own
 * tests.
 *
 * @see app/(protected)/compare/[id]/page.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { anAssessCatalogue } from '@/tests/unit/components/app/workbench/fixtures';
import { aComparison } from '@/tests/unit/components/app/compare/fixtures';

const { getServerSession, clearInvalidSession, requireServerData, loadServerData } = vi.hoisted(
  () => ({
    getServerSession: vi.fn(),
    clearInvalidSession: vi.fn((returnUrl: string) => {
      throw new Error(`NEXT_REDIRECT ${returnUrl}`);
    }),
    requireServerData: vi.fn(),
    loadServerData: vi.fn(),
  })
);

vi.mock('@/lib/auth/utils', () => ({ getServerSession }));
vi.mock('@/lib/auth/clear-session', () => ({ clearInvalidSession }));
vi.mock('@/lib/api/server-load', () => ({ requireServerData, loadServerData }));
vi.mock('@/lib/api/client', () => ({ apiClient: { get: vi.fn() } }));
const logger = vi.hoisted(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger }));

import ComparePage, { metadata } from '@/app/(protected)/compare/[id]/page';

const params = Promise.resolve({ id: 'cmp 1' });

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } });
  requireServerData.mockResolvedValue({ data: aComparison(), meta: undefined });
  loadServerData.mockResolvedValue({ ok: true, data: anAssessCatalogue(), meta: undefined });
});

describe('/compare/[id]', () => {
  it('is titled Comparison', () => {
    expect(metadata.title).toBe('Comparison');
  });

  it('sends a signed-out reader to sign in, and back to this comparison', async () => {
    getServerSession.mockResolvedValue(null);
    await expect(ComparePage({ params })).rejects.toThrow('NEXT_REDIRECT /compare/cmp%201');
    expect(requireServerData).not.toHaveBeenCalled();
  });

  it('reads the comparison in one read, a missing one being the not-found page, and its version’s appeal names', async () => {
    render(await ComparePage({ params }));
    expect(requireServerData).toHaveBeenCalledTimes(1);
    expect(requireServerData).toHaveBeenCalledWith('/api/v1/comparisons/cmp%201', {
      notFound: true,
    });
    expect(loadServerData).toHaveBeenCalledWith(
      '/api/v1/frameworks/howdoesthisland/versions/0.5.2/catalogue'
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Which draft lands better');
    // Named from the catalogue, not by id.
    const names = anAssessCatalogue().result.appeals.map((a) => a.name);
    for (const name of names) expect(screen.getByRole('rowheader', { name })).toBeTruthy();
  });

  it('names the appeals by id when the catalogue cannot be read, rather than failing', async () => {
    loadServerData.mockResolvedValue({ ok: false, failure: { kind: 'server_error' } });
    render(await ComparePage({ params }));
    expect(screen.getByRole('rowheader', { name: 'ethos' })).toBeTruthy();
  });

  it('says a comparison it cannot read cannot be shown, and logs it', async () => {
    requireServerData.mockResolvedValue({ data: { id: 'cmp-1' }, meta: undefined });
    render(await ComparePage({ params }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'This comparison can’t be shown'
    );
    expect(logger.error).toHaveBeenCalled();
  });
});
