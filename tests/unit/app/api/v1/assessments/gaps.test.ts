/**
 * Tests: GET /api/v1/assessments/{id}/gaps (t-108).
 *
 * Real: the guard (session, API key and its scope, tenant context) and the
 * id's validation. Mocked: the coaching service, whose own tests are
 * `tests/unit/lib/app/coaching/service.test.ts`, so these check what the
 * route adds: who may call, in which workspace, and how a refusal is sent.
 *
 * @see app/api/v1/assessments/[id]/gaps/route.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'test' as const,
  TENANCY_MODE: 'multi',
  NEXT_PUBLIC_APP_URL: 'http://app.test',
  BETTER_AUTH_URL: 'http://app.test',
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  membership: vi.fn(),
  apiKey: vi.fn(),
  getGaps: vi.fn(),
  orgSeen: [] as (string | undefined)[],
}));
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(new Headers())) }));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    orgMembership: { findUnique: mocks.membership, findMany: vi.fn(async () => []) },
    orgSupportGrant: { findFirst: vi.fn(async () => null) },
    aiApiKey: { findFirst: mocks.apiKey, update: vi.fn(async () => ({})) },
    user: { findUnique: vi.fn(async () => null) },
    org: { findUnique: vi.fn(async () => null) },
  },
}));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: log }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: vi.fn(async () => log) }));
vi.mock('@/lib/app/coaching/service', () => ({ getGaps: mocks.getGaps }));

import { GET } from '@/app/api/v1/assessments/[id]/gaps/route';
import { APIError, NotFoundError } from '@/lib/api/errors';
import { gapsSchema } from '@/lib/app/coaching/wire';
import { requireOrgId } from '@/lib/tenancy/context';
import { createMockAuthSession } from '@/tests/helpers/auth';

const WS_A = 'org-a';
const ALICE = 'cmuser0000000000000alice1';
const KEY_ID = 'cmkey000000000000000key1';
const KEY_HEADERS = { authorization: 'Bearer sk_deadbeefdeadbeefdeadbeefdeadbeef' };
const ID = 'cmassessment00000000000a1';

function signedIn(userId = ALICE, orgId = WS_A) {
  const base = createMockAuthSession();
  mocks.getSession.mockResolvedValue({
    session: { ...base.session, userId, activeOrgId: orgId },
    user: { ...base.user, id: userId },
  });
}

function withKey(scopes: string[]) {
  mocks.getSession.mockResolvedValue(null);
  mocks.apiKey.mockResolvedValue({
    id: KEY_ID,
    userId: ALICE,
    scopes,
    rateLimitRpm: null,
    expiresAt: null,
    createdAt: new Date(),
    orgId: WS_A,
    user: {
      id: ALICE,
      name: 'Alice',
      email: 'alice@example.com',
      emailVerified: true,
      image: null,
      role: 'USER',
      accountType: 'HUMAN',
      erasureRequestedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

const ANSWER = {
  assessmentId: ID,
  gaps: [
    {
      id: 'customer-proof',
      missing: 'Proof from a customer like your reader',
      question: 'Have you solved this for someone like your reader?',
      why: 'Proof from someone like the reader persuades.',
      found: ['The results are claimed, not shown.'],
      sources: [{ kind: 'recommendation', number: 2 }],
    },
  ],
};

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

const get = (id = ID, headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://localhost/api/v1/assessments/${id}/gaps`, { headers }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.orgSeen.length = 0;
  mocks.membership.mockImplementation(
    async ({ where }: { where: { orgId_userId: { userId: string; orgId: string } } }) => {
      const { userId, orgId } = where.orgId_userId;
      return userId === ALICE && orgId === WS_A
        ? { role: 'MEMBER', org: { status: 'ACTIVE' } }
        : null;
    }
  );
  mocks.apiKey.mockResolvedValue(null);
  signedIn();
  mocks.getGaps.mockImplementation(async () => {
    mocks.orgSeen.push(requireOrgId());
    return ANSWER;
  });
});

describe('GET /api/v1/assessments/{id}/gaps', () => {
  it('answers the review’s gaps, read in the caller’s workspace', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope;
    expect(gapsSchema.parse(body.data)).toEqual(ANSWER);
    expect(mocks.getGaps).toHaveBeenCalledWith(ID);
    expect(mocks.orgSeen).toEqual([WS_A]);
  });

  it('refuses an unfinished review with 409 ASSESSMENT_NOT_FINISHED', async () => {
    mocks.getGaps.mockRejectedValue(
      new APIError('This review has not finished yet.', 'ASSESSMENT_NOT_FINISHED', 409)
    );
    const res = await get();
    expect(res.status).toBe(409);
    expect(((await res.json()) as Envelope).error?.code).toBe('ASSESSMENT_NOT_FINISHED');
  });

  it('404s a review not in the workspace', async () => {
    mocks.getGaps.mockRejectedValue(new NotFoundError('Assessment not found'));
    expect((await get()).status).toBe(404);
  });

  it('refuses a caller who is not a member of the workspace', async () => {
    signedIn('cmuser00000000000000bob01', WS_A);
    expect((await get()).status).toBe(403);
    expect(mocks.getGaps).not.toHaveBeenCalled();
  });

  it('401s with no session or key', async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(mocks.getGaps).not.toHaveBeenCalled();
  });

  it('takes an API key with the assess scope, and refuses one without it', async () => {
    withKey(['assess']);
    expect((await get(ID, KEY_HEADERS)).status).toBe(200);
    withKey(['reports']);
    expect((await get(ID, KEY_HEADERS)).status).toBe(403);
    expect(mocks.getGaps).toHaveBeenCalledTimes(1);
  });
});
