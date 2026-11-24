/**
 * Tests: a project's documents routes (t-74).
 *
 * GET/POST /api/v1/projects/{id}/documents · DELETE …/documents/{documentId}
 *
 * Real: the guard (session, API key and its scope, org entry at `multi`) and
 * the service. Replaced: Prisma by a small fake of the tables the service
 * reads, core's `uploadDocument` (so nothing is chunked or embedded), and the
 * add sub-cap's limiter, so a test can exhaust it.
 *
 * The removal rule and the created-row detection are tested against the
 * service in tests/unit/lib/app/projects/documents.test.ts.
 *
 * @see app/api/v1/projects/[id]/documents/
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
  limit: vi.fn(),
}));
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(new Headers())) }));

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  projects: [] as Record<string, unknown>[],
  links: [] as Record<string, unknown>[],
  knowledge: [] as Record<string, unknown>[],
}));
const matches = (row: Row, where: Row = {}) =>
  Object.entries(where).every(([key, value]) =>
    value && typeof value === 'object' && 'in' in value
      ? (value as { in: unknown[] }).in.includes(row[key])
      : row[key] === value
  );

vi.mock('@/lib/db/client', () => {
  const client: Record<string, unknown> = {
    project: {
      findFirst: vi.fn(
        async ({ where }: { where: Row }) => state.projects.find((r) => matches(r, where)) ?? null
      ),
    },
    projectDocument: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        state.links.filter((r) => matches(r, where))
      ),
      findFirst: vi.fn(
        async ({ where }: { where: Row }) => state.links.find((r) => matches(r, where)) ?? null
      ),
      count: vi.fn(
        async ({ where }: { where: Row }) => state.links.filter((r) => matches(r, where)).length
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `link-${state.links.length + 1}`, createdAt: new Date(), ...data };
        state.links.push(row);
        return row;
      }),
      delete: vi.fn(async ({ where }: { where: Row }) => {
        const i = state.links.findIndex((r) => matches(r, where));
        return state.links.splice(i, 1)[0];
      }),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    aiKnowledgeDocument: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        state.knowledge.filter((r) => matches(r, where))
      ),
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const before = state.knowledge.length;
        state.knowledge = state.knowledge.filter((r) => !matches(r, where));
        return { count: before - state.knowledge.length };
      }),
    },
    aiAgentKnowledgeDocument: { count: vi.fn(async () => 0) },
    aiKnowledgeDocumentTag: { count: vi.fn(async () => 0) },
    orgMembership: { findUnique: mocks.membership, findMany: vi.fn(async () => []) },
    orgSupportGrant: { findFirst: vi.fn(async () => null) },
    aiApiKey: { findFirst: mocks.apiKey, update: vi.fn(async () => ({})) },
    user: { findUnique: vi.fn(async () => null) },
    org: { findUnique: vi.fn(async () => null) },
  };
  client.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client));
  return { prisma: client };
});
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: log }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: vi.fn(async () => log) }));
vi.mock('@/lib/orchestration/knowledge/document-manager', () => ({
  uploadDocument: vi.fn(async (content: string, fileName: string, userId: string) => {
    const row = {
      id: `kdoc-${state.knowledge.length + 1}`,
      fileHash: content,
      fileName,
      uploadedBy: userId,
      status: 'ready',
      chunkCount: 2,
      // Only workspace A's members add documents here.
      orgId: 'org-a',
    };
    state.knowledge.push(row);
    return row;
  }),
}));
vi.mock('@/lib/orchestration/knowledge/resolveAgentDocumentAccess', () => ({
  invalidateAllAgentAccess: vi.fn(),
}));
vi.mock('@/lib/app/projects/document-limiter', () => ({
  documentAddLimiter: { check: mocks.limit },
}));

import { GET as list, POST as add } from '@/app/api/v1/projects/[id]/documents/route';
import { DELETE as remove } from '@/app/api/v1/projects/[id]/documents/[documentId]/route';
import { createMockAuthSession } from '@/tests/helpers/auth';
import { uploadDocument } from '@/lib/orchestration/knowledge/document-manager';
import { APP_ROUTES } from '@/lib/app/api/registry';
import { projectDocumentSchema } from '@/lib/app/projects/wire';

const WS_A = 'org-a';
const WS_B = 'org-b';
const ALICE = 'cmuser0000000000000alice1';
const KEY_ID = 'cmkey000000000000000key1';

function signedIn(userId: string, orgId: string) {
  const base = createMockAuthSession();
  mocks.getSession.mockResolvedValue({
    session: { ...base.session, userId, activeOrgId: orgId },
    user: { ...base.user, id: userId },
  });
}

/** An API key of Alice's, bound to workspace A, with `scopes`. */
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
const KEY_HEADERS = { authorization: 'Bearer sk_deadbeefdeadbeefdeadbeefdeadbeef' };

const BASE = 'http://localhost/api/v1/projects';
const FILE_BODY = {
  source: {
    file: { name: 'voice.txt', base64: Buffer.from('Plain and warm.').toString('base64') },
  },
};

const post = (id: string, body: unknown, headers: Record<string, string> = {}) =>
  add(
    new NextRequest(`${BASE}/${id}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
const getList = (id: string, headers: Record<string, string> = {}) =>
  list(new NextRequest(`${BASE}/${id}/documents`, { headers }), {
    params: Promise.resolve({ id }),
  });
const del = (id: string, documentId: string) =>
  remove(new NextRequest(`${BASE}/${id}/documents/${documentId}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id, documentId }),
  });

interface Envelope {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}
const json = async (res: Response) => (await res.json()) as Envelope;

beforeEach(() => {
  vi.clearAllMocks();
  state.projects = [
    { id: 'proj-a', orgId: WS_A },
    { id: 'proj-b', orgId: WS_B },
  ];
  state.links = [];
  state.knowledge = [];
  mocks.membership.mockImplementation(
    async ({ where }: { where: { orgId_userId: { orgId: string } } }) =>
      where.orgId_userId.orgId === WS_A ? { role: 'MEMBER', org: { status: 'ACTIVE' } } : null
  );
  mocks.limit.mockReturnValue({ success: true, limit: 20, remaining: 19, reset: Date.now() });
  signedIn(ALICE, WS_A);
});

describe('POST /api/v1/projects/{id}/documents', () => {
  it('adds a file and answers 201 with the document as the registry declares it', async () => {
    const res = await post('proj-a', FILE_BODY);
    const body = await json(res);

    expect(res.status).toBe(201);
    expect(projectDocumentSchema.parse(body.data)).toMatchObject({
      title: 'voice',
      fileName: 'voice.txt',
      status: 'ready',
    });
    expect(mocks.limit).toHaveBeenCalledWith(`user:${ALICE}`);
  });

  it('answers 200 with the existing link when the project already holds the text', async () => {
    await post('proj-a', FILE_BODY);
    vi.mocked(uploadDocument).mockResolvedValueOnce(
      state.knowledge[0] as unknown as Awaited<ReturnType<typeof uploadDocument>>
    );

    const res = await post('proj-a', FILE_BODY);

    expect(res.status).toBe(200);
    expect(state.links).toHaveLength(1);
  });

  it("is 404 for another workspace's project, and reads nothing", async () => {
    const res = await post('proj-b', FILE_BODY);

    expect(res.status).toBe(404);
    expect((await json(res)).error?.code).toBe('NOT_FOUND');
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it('refuses a body with pasted text, which is not a document source', async () => {
    const res = await post('proj-a', { source: { text: 'Plain and warm.' } });

    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe('VALIDATION_ERROR');
  });

  it('is 429 once the person has used their adds, before anything is read', async () => {
    mocks.limit.mockReturnValue({ success: false, limit: 20, remaining: 0, reset: Date.now() });

    const res = await post('proj-a', FILE_BODY);

    expect(res.status).toBe(429);
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it('takes an API key with the projects scope', async () => {
    withKey(['projects']);

    const res = await post('proj-a', FILE_BODY, KEY_HEADERS);

    expect(res.status).toBe(201);
  });

  it('refuses an API key without the projects scope', async () => {
    withKey(['assess']);

    const res = await post('proj-a', FILE_BODY, KEY_HEADERS);

    expect(res.status).toBe(403);
    expect(uploadDocument).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/projects/{id}/documents', () => {
  it("lists the project's documents", async () => {
    await post('proj-a', FILE_BODY);

    const res = await getList('proj-a');
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(projectDocumentSchema.array().parse(body.data)).toHaveLength(1);
  });

  it("is 404 for another workspace's project", async () => {
    expect((await getList('proj-b')).status).toBe(404);
  });

  it('refuses an API key without the projects scope', async () => {
    withKey(['assess']);

    expect((await getList('proj-a', KEY_HEADERS)).status).toBe(403);
  });
});

describe('DELETE /api/v1/projects/{id}/documents/{documentId}', () => {
  it('removes the link and says the knowledge document went with it', async () => {
    const added = projectDocumentSchema.parse((await json(await post('proj-a', FILE_BODY))).data);

    const res = await del('proj-a', added.id);

    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ id: added.id, knowledgeDocumentDeleted: true });
    expect(state.links).toEqual([]);
  });

  it("is 404 for another workspace's project, and for a document not in the project", async () => {
    const added = projectDocumentSchema.parse((await json(await post('proj-a', FILE_BODY))).data);

    expect((await del('proj-b', added.id)).status).toBe(404);
    expect((await del('proj-a', 'no-such-doc')).status).toBe(404);
    expect(state.links).toHaveLength(1);
  });
});

const PROJECTS_AUTH = { who: 'signed-in', apiKeyScope: 'projects' };

describe('the route registry', () => {
  it('declares the three routes with the projects scope', () => {
    const declared = APP_ROUTES.filter((route) => route.path.includes('/documents')).map(
      (route) => [route.method, route.path, route.auth]
    );

    expect(declared).toEqual([
      ['GET', '/api/v1/projects/{id}/documents', PROJECTS_AUTH],
      ['POST', '/api/v1/projects/{id}/documents', PROJECTS_AUTH],
      ['DELETE', '/api/v1/projects/{id}/documents/{documentId}', PROJECTS_AUTH],
    ]);
  });
});
