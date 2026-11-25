/**
 * Tests: the rewrites routes (t-81) — POST/GET /api/v1/rewrites and GET
 * /api/v1/rewrites/{id}.
 *
 * Real: the guard (session, API key and its scope, tenant context), body
 * and query validation, the per-user rate limit, and the SSE bridge.
 * Mocked: the rewrites service, whose own tests are
 * `tests/unit/lib/app/rewrites/service.test.ts`, so these check what the
 * routes add: who may call, what is parsed, and how the answer is sent.
 *
 * @see app/api/v1/rewrites/route.ts · app/api/v1/rewrites/[id]/route.ts
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
  startRewrite: vi.fn(),
  getRewrite: vi.fn(),
  listRewrites: vi.fn(),
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
vi.mock('@/lib/app/rewrites/limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/rewrites/limits')>()),
  REWRITES_PER_MINUTE: 2,
}));
vi.mock('@/lib/app/rewrites/service', () => ({
  startRewrite: mocks.startRewrite,
  getRewrite: mocks.getRewrite,
  listRewrites: mocks.listRewrites,
}));

import { POST as create, GET as list } from '@/app/api/v1/rewrites/route';
import { GET as read } from '@/app/api/v1/rewrites/[id]/route';
import { APIError, NotFoundError } from '@/lib/api/errors';
import { rewriteEventSchema, rewriteSchema } from '@/lib/app/rewrites/wire';
import type { RewriteEvent } from '@/lib/app/rewrites/service';
import type { RewriteView } from '@/lib/app/rewrites/views';
import { rewriteLimiter } from '@/lib/app/rewrites/limiter';
import { requireOrgId } from '@/lib/tenancy/context';
import { createMockAuthSession } from '@/tests/helpers/auth';

const WS_A = 'org-a';
const ALICE = 'cmuser0000000000000alice1';
const KEY_ID = 'cmkey000000000000000key1';
const KEY_HEADERS = { authorization: 'Bearer sk_deadbeefdeadbeefdeadbeefdeadbeef' };
const BASE = 'http://localhost/api/v1/rewrites';

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

const view = (over: Partial<RewriteView> = {}): RewriteView => ({
  id: 'rw-1',
  assessmentId: 'assessment-1',
  focus: 'balanced',
  status: 'completed',
  draft: 'A better draft.',
  placeholders: [],
  error: null,
  errorCode: null,
  model: 'claude-sonnet-5-5',
  costUsd: 0.04,
  createdAt: '2026-11-25T10:00:00.000Z',
  completedAt: '2026-11-25T10:00:20.000Z',
  ...over,
});

async function* eventsOf(list: RewriteEvent[]): AsyncGenerator<RewriteEvent> {
  for (const event of list) yield event;
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  create(
    new NextRequest(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  );

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}
const json = async (res: Response) => (await res.json()) as Envelope;

async function frames(res: Response): Promise<{ event: string; data: unknown }[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((frame) => frame.startsWith('event:'))
    .map((frame) => {
      const [eventLine = '', dataLine = ''] = frame.split('\n');
      return {
        event: eventLine.slice('event: '.length),
        data: JSON.parse(dataLine.slice('data: '.length)) as unknown,
      };
    });
}

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
  rewriteLimiter.reset(`user:${ALICE}`);
  signedIn();
  mocks.startRewrite.mockImplementation(async () => {
    mocks.orgSeen.push(requireOrgId());
    const done = view();
    return {
      rewrite: view({ status: 'running', draft: '', completedAt: null }),
      events: eventsOf([
        { type: 'rewrite', rewrite: view({ status: 'running', draft: '', completedAt: null }) },
        { type: 'rewrite_text', text: 'A better ' },
        { type: 'rewrite_text', text: 'draft.' },
        { type: 'rewrite_done', rewrite: done },
      ]),
      done: Promise.resolve(done),
    };
  });
});

describe('POST /api/v1/rewrites', () => {
  it('answers the rewrite once it ends, by default', async () => {
    const res = await post({ assessmentId: 'assessment-1' });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(rewriteSchema.parse(body.data)).toEqual(view());
    expect(mocks.startRewrite).toHaveBeenCalledWith(
      { assessmentId: 'assessment-1', stream: false },
      { userId: ALICE },
      expect.any(AbortSignal)
    );
    expect(mocks.orgSeen).toEqual([WS_A]);
  });

  it('streams the events as SSE with stream: true, each one the registry’s shape', async () => {
    const res = await post({ assessmentId: 'assessment-1', focus: 'pathos', stream: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const got = await frames(res);
    expect(got.map((f) => f.event)).toEqual([
      'rewrite',
      'rewrite_text',
      'rewrite_text',
      'rewrite_done',
    ]);
    for (const frame of got) expect(rewriteEventSchema.safeParse(frame.data).success).toBe(true);
    expect(mocks.startRewrite).toHaveBeenCalledWith(
      { assessmentId: 'assessment-1', focus: 'pathos', stream: true },
      { userId: ALICE },
      expect.any(AbortSignal)
    );
  });

  it('refuses a body that does not fit, before anything starts', async () => {
    for (const body of [
      {},
      { assessmentId: '' },
      { assessmentId: 'a', extra: 1 },
      { assessmentId: 'a', stream: 'yes' },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect((await json(res)).error?.code).toBe('VALIDATION_ERROR');
    }
    expect(mocks.startRewrite).not.toHaveBeenCalled();
  });

  it('passes the service’s refusal through as its status and code', async () => {
    mocks.startRewrite.mockRejectedValueOnce(
      new APIError('Not finished.', 'ASSESSMENT_NOT_REWRITABLE', 409)
    );
    const res = await post({ assessmentId: 'assessment-1' });
    expect(res.status).toBe(409);
    expect((await json(res)).error?.code).toBe('ASSESSMENT_NOT_REWRITABLE');
  });

  it('caps rewrites per user per minute, before the service is asked', async () => {
    expect((await post({ assessmentId: 'a' })).status).toBe(200);
    expect((await post({ assessmentId: 'a' })).status).toBe(200);
    const res = await post({ assessmentId: 'a' });
    expect(res.status).toBe(429);
    expect(mocks.startRewrite).toHaveBeenCalledTimes(2);
  });

  it('401s with no session or key', async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await post({ assessmentId: 'a' })).status).toBe(401);
    expect(mocks.startRewrite).not.toHaveBeenCalled();
  });

  it('takes an API key with the assess scope, and refuses one without it', async () => {
    withKey(['assess']);
    expect((await post({ assessmentId: 'a' }, KEY_HEADERS)).status).toBe(200);
    withKey(['reports']);
    expect((await post({ assessmentId: 'a' }, KEY_HEADERS)).status).toBe(403);
    expect(mocks.startRewrite).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/v1/rewrites', () => {
  it('lists a review’s rewrites', async () => {
    mocks.listRewrites.mockResolvedValue([view()]);
    const res = await list(new NextRequest(`${BASE}?assessmentId=assessment-1`));
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual([view()]);
    expect(mocks.listRewrites).toHaveBeenCalledWith('assessment-1');
  });

  it('400s with no assessmentId', async () => {
    const res = await list(new NextRequest(BASE));
    expect(res.status).toBe(400);
    expect(mocks.listRewrites).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/rewrites/{id}', () => {
  const getOne = (id: string) =>
    read(new NextRequest(`${BASE}/${id}`), { params: Promise.resolve({ id }) });

  it('reads one rewrite', async () => {
    mocks.getRewrite.mockResolvedValue(view({ status: 'running', completedAt: null }));
    const res = await getOne('rw-1');
    expect(res.status).toBe(200);
    expect(rewriteSchema.parse((await json(res)).data).status).toBe('running');
    expect(mocks.getRewrite).toHaveBeenCalledWith('rw-1');
  });

  it('404s one not in the workspace', async () => {
    mocks.getRewrite.mockRejectedValue(new NotFoundError('Rewrite not found'));
    expect((await getOne('rw-x')).status).toBe(404);
  });
});
