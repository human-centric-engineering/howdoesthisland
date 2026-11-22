/**
 * The fork's protected prefixes, through the real seam (t-71): the proxy
 * reads `lib/app/protected-routes.ts` unmocked, so a signed-out request to
 * each app section is sent to sign in, and a signed-in one goes through.
 *
 * Mocked: only what the proxy does besides the auth gate (rate limiting,
 * headers, the frame-ancestors resolver), as `tests/unit/lib/security/proxy.test.ts`
 * does.
 *
 * FORK NOTE: this is HowDoesThisLand's own test and reads the real
 * `lib/app/protected-routes.ts` on purpose: what it proves is that the value
 * we filled the seam with protects `/projects`. Removing `/projects` from the
 * seam fails it, and should; the exact list is pinned in
 * `tests/unit/lib/app/defaults.test.ts`.
 *
 * @see lib/app/protected-routes.ts
 * @see proxy.ts
 */
import { describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/security/headers', () => ({ setSecurityHeaders: vi.fn() }));
vi.mock('@/lib/security/rate-limit-middleware', () => ({
  applyRateLimit: vi.fn(async () => null),
}));
vi.mock('@/lib/app/frame-ancestors', () => ({ resolveAppFrameAncestors: vi.fn(async () => []) }));

import { proxy } from '@/proxy';
import { appProtectedRoutes } from '@/lib/app/protected-routes';

function request(pathname: string, cookies: Record<string, string> = {}): NextRequest {
  const url = `http://localhost:3000${pathname}`;
  return {
    nextUrl: new URL(url),
    url,
    method: 'GET',
    headers: new Map(),
    cookies: {
      get: (name: string) => (cookies[name] ? { name, value: cookies[name] } : undefined),
    },
  } as unknown as NextRequest;
}

describe('the app’s protected sections', () => {
  it('includes /projects', () => {
    expect(appProtectedRoutes).toContain('/projects');
  });

  it.each(['/projects', '/projects/proj-1'])('sends a signed-out %s to sign in', async (path) => {
    const response = await proxy(request(path));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('callbackUrl')).toBe(path);
  });

  it('lets a signed-in /projects through', async () => {
    const response = await proxy(
      request('/projects', { 'better-auth.session_token': 'a-session' })
    );

    expect(response.status).toBe(200);
  });
});
