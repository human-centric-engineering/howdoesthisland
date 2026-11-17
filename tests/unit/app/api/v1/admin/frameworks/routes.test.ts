/**
 * The admin calibration routes (t-38), through the real `withAdminAuth`: a
 * platform admin is admitted, a USER and an org OWNER who is not a platform
 * admin are refused before any read or run, the starter is the session's
 * user, and a quick run answers 201 where an AI run answers 202. The page is
 * refused to a non-admin by the admin layout's tier rule, checked here too.
 *
 * The service is mocked: `tests/unit/lib/app/calibration/admin.test.ts` runs
 * it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { ORG_OWNER_ROLE } from '@/lib/tenancy/roles';

const mockEnv = vi.hoisted(() => ({ TENANCY_MODE: 'single' }));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: mockGetSession } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(new Headers())) }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    orgMembership: { findUnique: vi.fn() },
    aiApiKey: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

const service = vi.hoisted(() => ({
  listFrameworkCalibration: vi.fn(),
  startCalibrationRun: vi.fn(),
}));
vi.mock('@/lib/app/calibration/admin', () => service);

const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: vi.fn(async () => mockLog) }));
vi.mock('@/lib/logging', () => ({ logger: mockLog }));

import { GET } from '@/app/api/v1/admin/frameworks/route';
import { POST } from '@/app/api/v1/admin/frameworks/[slug]/versions/[version]/calibration-runs/route';
import { APIError } from '@/lib/api/errors';
import { adminPageTierOf, reachesAdminPage } from '@/lib/auth/admin-tier';
import { namedTierAdminPages, orgTierAdminPages } from '@/lib/auth/org-tier-admin-pages';
import { prisma } from '@/lib/db/client';
import { createMockAuthSession } from '@/tests/helpers/auth';

function session(role: 'USER' | 'ADMIN') {
  const base = createMockAuthSession();
  return { session: { ...base.session, activeOrgId: null }, user: { ...base.user, role } };
}

const get = () =>
  GET(new Request('http://localhost/api/v1/admin/frameworks') as unknown as NextRequest);

const post = (body: unknown, version = '0.5.1', slug = 'howdoesthisland') =>
  POST(
    new Request(
      `http://localhost/api/v1/admin/frameworks/${slug}/versions/${version}/calibration-runs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    ) as unknown as NextRequest,
    { params: Promise.resolve({ slug, version }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.aiApiKey.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue(null);
  service.listFrameworkCalibration.mockResolvedValue({
    slug: 'howdoesthisland',
    name: 'HowDoesThisLand',
    versions: [],
  });
});

describe('who may call them', () => {
  it('refuses a request with no session', async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect((await post({ mode: 'quick' })).status).toBe(401);
    expect(service.listFrameworkCalibration).not.toHaveBeenCalled();
    expect(service.startCalibrationRun).not.toHaveBeenCalled();
  });

  it('refuses a USER, before any read or run', async () => {
    mockGetSession.mockResolvedValue(session('USER'));
    expect((await get()).status).toBe(403);
    expect((await post({ mode: 'ai' })).status).toBe(403);
    expect(service.listFrameworkCalibration).not.toHaveBeenCalled();
    expect(service.startCalibrationRun).not.toHaveBeenCalled();
  });

  it('refuses an org OWNER who is not a platform admin', async () => {
    mockGetSession.mockResolvedValue(session('USER'));
    vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue({
      role: ORG_OWNER_ROLE,
    } as never);
    expect((await get()).status).toBe(403);
    expect((await post({ mode: 'ai' })).status).toBe(403);
    expect(service.startCalibrationRun).not.toHaveBeenCalled();
  });

  it('keeps the page from anyone but a platform admin', () => {
    const tier = adminPageTierOf('/admin/frameworks', orgTierAdminPages(), namedTierAdminPages());
    expect(tier).toBeNull();
    expect(reachesAdminPage({ tiers: ['org'], landing: null }, '/admin/frameworks', tier)).toBe(
      false
    );
    expect(reachesAdminPage('platform', '/admin/frameworks', tier)).toBe(true);
  });
});

describe('GET /api/v1/admin/frameworks', () => {
  it('answers a platform admin with the framework’s calibration', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    const res = await get();
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toEqual({
      success: true,
      data: [{ slug: 'howdoesthisland', name: 'HowDoesThisLand', versions: [] }],
    });
  });
});

describe('POST …/calibration-runs', () => {
  it('starts a quick run as the session’s user and answers 201 once complete', async () => {
    const admin = session('ADMIN');
    mockGetSession.mockResolvedValue(admin);
    service.startCalibrationRun.mockResolvedValue({ runId: 'run-1', status: 'complete' });
    const res = await post({ mode: 'quick' });
    expect(res.status).toBe(201);
    expect(service.startCalibrationRun).toHaveBeenCalledWith({
      version: '0.5.1',
      mode: 'quick',
      userId: admin.user.id,
    });
  });

  it('answers 202 for an AI run, which carries on after the response', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    service.startCalibrationRun.mockResolvedValue({ runId: 'run-2', status: 'running' });
    const res = await post({ mode: 'ai' });
    expect(res.status).toBe(202);
    const body: unknown = await res.json();
    expect(body).toMatchObject({ data: { runId: 'run-2', status: 'running' } });
  });

  it('refuses a mode it does not know', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    expect((await post({ mode: 'slow' })).status).toBe(400);
    expect(service.startCalibrationRun).not.toHaveBeenCalled();
  });

  it('answers 404 for a framework other than the one with a calibration set', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    expect((await post({ mode: 'quick' }, '0.5.1', 'other')).status).toBe(404);
    expect((await post({ mode: 'quick' }, 'not-a-version')).status).toBe(404);
    expect(service.startCalibrationRun).not.toHaveBeenCalled();
  });

  it('passes the service’s refusal through with its code', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    service.startCalibrationRun.mockRejectedValue(
      new APIError('An AI run of 0.5.1 is still running.', 'CALIBRATION_RUNNING', 409, {
        runId: 'run-2',
      })
    );
    const res = await post({ mode: 'ai' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'CALIBRATION_RUNNING' } });
  });
});
