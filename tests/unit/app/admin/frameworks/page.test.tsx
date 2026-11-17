// @vitest-environment happy-dom

/**
 * Admin — Frameworks page (t-38): a thin shell over
 * `GET /api/v1/admin/frameworks`. Only `serverFetch` is faked.
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

import FrameworksPage from '@/app/admin/frameworks/page';
import { serverFetch } from '@/lib/api/server-fetch';
import { ServerLoadError } from '@/lib/api/server-load';
import { apiFailure, apiSuccess } from '@/tests/helpers/api';
import { version } from '@/tests/unit/components/app/admin/frameworks/fixtures';

beforeEach(() => vi.clearAllMocks());

describe('FrameworksPage', () => {
  it('renders the framework’s versions from the admin endpoint', async () => {
    vi.mocked(serverFetch).mockResolvedValue(
      apiSuccess([{ slug: 'howdoesthisland', name: 'HowDoesThisLand', versions: [version()] }])
    );
    render(await FrameworksPage());
    expect(vi.mocked(serverFetch).mock.calls[0][0]).toBe('/api/v1/admin/frameworks');
    expect(screen.getByRole('heading', { name: /Frameworks/ })).toBeInTheDocument();
    expect(screen.getByText('0.5.1')).toBeInTheDocument();
  });

  it('says so when no framework comes back', async () => {
    vi.mocked(serverFetch).mockResolvedValue(apiSuccess([]));
    render(await FrameworksPage());
    expect(screen.getByText('No frameworks could be loaded.')).toBeInTheDocument();
  });

  it('refuses a body that is not the list, rather than rendering it', async () => {
    vi.mocked(serverFetch).mockResolvedValue(apiSuccess({ versions: [] }));
    await expect(FrameworksPage()).rejects.toThrow();
    // A list whose run lacks its fields is refused too, at the boundary.
    vi.mocked(serverFetch).mockResolvedValue(
      apiSuccess([{ slug: 'howdoesthisland', name: 'HowDoesThisLand', versions: [{ id: 'v' }] }])
    );
    await expect(FrameworksPage()).rejects.toThrow();
  });

  it('throws to the error boundary when the load fails', async () => {
    vi.mocked(serverFetch).mockResolvedValue(apiFailure(500));
    await expect(FrameworksPage()).rejects.toBeInstanceOf(ServerLoadError);
  });
});
