/**
 * Tests: a project's context documents (t-74) — adding, with whether the
 * upload made the knowledge row, and the removal rule.
 *
 * Real: the service, and intake's reader for plain-text files. Replaced:
 * Prisma by a small stateful fake of the tables the service touches (so
 * assertions read the rows left behind), and core's `uploadDocument` by a
 * fake that deduplicates by content hash the way core's does, so no text is
 * chunked or embedded. `fetchPage` is replaced for pages.
 *
 * @see lib/app/projects/documents.ts
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { uniqueViolationError } from '@/tests/helpers/prisma-errors';

type Row = Record<string, unknown>;

/** Equality, `{ in: [...] }` and `{ not }`, which is all of `where` the service uses on these tables. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && 'in' in value) {
      return (value as { in: unknown[] }).in.includes(row[key]);
    }
    if (value && typeof value === 'object' && 'not' in value) {
      return row[key] !== value.not;
    }
    return row[key] === value;
  });
}

function pick(row: Row, select?: Record<string, boolean>): Row {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
}

const db = vi.hoisted(() => ({
  state: {
    org: 'org-a',
    projects: [] as Record<string, unknown>[],
    links: [] as Record<string, unknown>[],
    knowledge: [] as Record<string, unknown>[],
    /** Direct agent grants, and the documents that carry a tag, by document id. */
    directGrants: [] as string[],
    taggedDocs: [] as string[],
    seq: 0,
  },
}));

function linkTable() {
  return {
    findMany: vi.fn(async ({ where, select }: { where: Row; select?: Record<string, boolean> }) =>
      db.state.links.filter((r) => matches(r, where)).map((r) => pick(r, select))
    ),
    findFirst: vi.fn(
      async ({ where, select }: { where: Row; select?: Record<string, boolean> }) => {
        const row = db.state.links.find((r) => matches(r, where));
        return row ? pick(row, select) : null;
      }
    ),
    count: vi.fn(
      async ({ where }: { where: Row }) => db.state.links.filter((r) => matches(r, where)).length
    ),
    create: vi.fn(async ({ data, select }: { data: Row; select?: Record<string, boolean> }) => {
      const clash = db.state.links.some(
        (r) => r.projectId === data.projectId && r.knowledgeDocumentId === data.knowledgeDocumentId
      );
      if (clash) {
        throw uniqueViolationError({
          index: 'app_project_document_projectId_knowledgeDocumentId_key',
          modelName: 'ProjectDocument',
        });
      }
      if (!db.state.knowledge.some((k) => k.id === data.knowledgeDocumentId)) {
        throw new Prisma.PrismaClientKnownRequestError('Foreign key constraint violated', {
          code: 'P2003',
          clientVersion: '7.0.0',
        });
      }
      db.state.seq += 1;
      const row: Row = {
        id: `link-${db.state.seq}`,
        createdAt: new Date(Date.UTC(2026, 10, 23, 0, 0, db.state.seq)),
        ...data,
      };
      db.state.links.push(row);
      return pick(row, select);
    }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const row = db.state.links.find((r) => matches(r, where));
      if (!row) throw new Error('no such link');
      Object.assign(row, data);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const hit = db.state.links.filter((r) => matches(r, where));
      for (const row of hit) Object.assign(row, data);
      return { count: hit.length };
    }),
    delete: vi.fn(async ({ where }: { where: Row }) => {
      const index = db.state.links.findIndex((r) => matches(r, where));
      if (index < 0) throw new Error('no such link');
      return db.state.links.splice(index, 1)[0];
    }),
  };
}

function knowledgeTable() {
  return {
    findMany: vi.fn(async ({ where, select }: { where: Row; select?: Record<string, boolean> }) =>
      db.state.knowledge.filter((r) => matches(r, where)).map((r) => pick(r, select))
    ),
    deleteMany: vi.fn(async ({ where }: { where: Row }) => {
      const before = db.state.knowledge.length;
      db.state.knowledge = db.state.knowledge.filter((r) => !matches(r, where));
      // Links cascade with their knowledge row (the hand-written FK).
      const ids = new Set(db.state.knowledge.map((r) => r.id));
      db.state.links = db.state.links.filter((l) => ids.has(l.knowledgeDocumentId));
      return { count: before - db.state.knowledge.length };
    }),
  };
}

const tables = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock('@/lib/db/client', () => ({
  get prisma() {
    return tables.current;
  },
}));
vi.mock('@/lib/tenancy/context', () => ({ requireOrgId: () => db.state.org }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const upload = vi.hoisted(() => ({
  /** Runs inside the fake `uploadDocument`, after its dedupe read: a racing upload. */
  during: null as (() => void) | null,
  fail: false,
}));
vi.mock('@/lib/orchestration/knowledge/document-manager', () => ({
  // Core's dedupe: an existing ready row with this text's hash is returned as it is.
  uploadDocument: vi.fn(
    async (content: string, fileName: string, userId: string, sourceUrl?: string) => {
      const fileHash = createHash('sha256').update(content).digest('hex');
      const existing = db.state.knowledge.find(
        (r) => r.fileHash === fileHash && r.status === 'ready'
      );
      if (existing) return existing;
      upload.during?.();
      // A racing upload of the same text won: core returns its row.
      const winner = db.state.knowledge.find((r) => r.fileHash === fileHash);
      if (winner) return winner;
      db.state.seq += 1;
      const row: Row = {
        id: `kdoc-${db.state.seq}`,
        fileHash,
        fileName,
        uploadedBy: userId,
        sourceUrl: sourceUrl ?? null,
        status: upload.fail ? 'failed' : 'ready',
        chunkCount: upload.fail ? 0 : 3,
        orgId: db.state.org,
      };
      db.state.knowledge.push(row);
      if (upload.fail) throw new Error('embedding provider unavailable');
      return row;
    }
  ),
}));
const invalidateAllAgentAccess = vi.hoisted(() => vi.fn());
vi.mock('@/lib/orchestration/knowledge/resolveAgentDocumentAccess', () => ({
  invalidateAllAgentAccess,
}));
const fetchPage = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/intake/fetch-page', () => ({ fetchPage }));

import {
  addProjectDocument,
  listProjectDocuments,
  MAX_PROJECT_DOCUMENTS,
  PROJECT_DOCUMENT_UNIQUE,
  removeProjectDocument,
} from '@/lib/app/projects/documents';
import { uploadDocument } from '@/lib/orchestration/knowledge/document-manager';

const ALICE = 'user-alice';
const BOB = 'user-bob';
const TEXT = 'Our voice is plain, warm and direct. We never say "solutions".';

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');
const fileSource = (text = TEXT, name = 'voice.txt') => ({
  source: { file: { name, base64: Buffer.from(text).toString('base64') } },
});

/** A knowledge row put there outside this app: core's knowledge page. */
function coreUpload(text: string, over: Row = {}): Row {
  db.state.seq += 1;
  const row: Row = {
    id: `kdoc-${db.state.seq}`,
    fileHash: hashOf(text),
    fileName: 'voice.txt',
    uploadedBy: BOB,
    status: 'ready',
    chunkCount: 5,
    orgId: db.state.org,
    ...over,
  };
  db.state.knowledge.push(row);
  return row;
}

function serializable(): unknown {
  return new Prisma.PrismaClientKnownRequestError('could not serialize access', {
    code: 'P2034',
    clientVersion: '7.0.0',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.state.org = 'org-a';
  db.state.projects = [
    { id: 'p1', orgId: 'org-a' },
    { id: 'p2', orgId: 'org-a' },
    { id: 'p-other', orgId: 'org-b' },
  ];
  db.state.links = [];
  db.state.knowledge = [];
  db.state.directGrants = [];
  db.state.taggedDocs = [];
  db.state.seq = 0;
  upload.during = null;
  upload.fail = false;
  const projectDocument = linkTable();
  const aiKnowledgeDocument = knowledgeTable();
  const client: Record<string, unknown> = {
    project: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const row = db.state.projects.find((r) => matches(r, where));
        return row ? { id: row.id, archivedAt: row.archivedAt ?? null } : null;
      }),
    },
    projectDocument,
    aiKnowledgeDocument,
    aiAgentKnowledgeDocument: {
      count: vi.fn(
        async ({ where }: { where: { documentId: string } }) =>
          db.state.directGrants.filter((id) => id === where.documentId).length
      ),
    },
    aiKnowledgeDocumentTag: {
      count: vi.fn(
        async ({ where }: { where: { documentId: string } }) =>
          db.state.taggedDocs.filter((id) => id === where.documentId).length
      ),
    },
  };
  // A transaction runs its callback against the same tables.
  client.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client));
  tables.current = client;
});

const linkOf = (id: string) => db.state.links.find((l) => l.id === id);

describe('addProjectDocument', () => {
  it('reads the file, indexes it, and links it, recording that this upload made the row', async () => {
    const { document, added } = await addProjectDocument('p1', fileSource(), ALICE);

    expect(added).toBe(true);
    expect(uploadDocument).toHaveBeenCalledWith(TEXT, 'voice.txt', ALICE, undefined, 'voice');
    expect(db.state.knowledge).toHaveLength(1);
    expect(linkOf(document.id)).toMatchObject({
      orgId: 'org-a',
      projectId: 'p1',
      knowledgeDocumentId: db.state.knowledge[0].id,
      title: 'voice',
      fileName: 'voice.txt',
      sourceUrl: null,
      createdByUpload: true,
      addedByUserId: ALICE,
    });
    expect(document).toMatchObject({ title: 'voice', status: 'ready', chunkCount: 3 });
  });

  it('takes the title it is given', async () => {
    const { document } = await addProjectDocument(
      'p1',
      { ...fileSource(), title: 'Tone of voice' },
      ALICE
    );

    expect(document.title).toBe('Tone of voice');
  });

  it('records a reuse by content hash: the text was already in the knowledge base', async () => {
    const existing = coreUpload(TEXT);

    const { document } = await addProjectDocument('p1', fileSource(), ALICE);

    expect(db.state.knowledge).toHaveLength(1);
    expect(linkOf(document.id)).toMatchObject({
      knowledgeDocumentId: existing.id,
      createdByUpload: false,
    });
    expect(document.chunkCount).toBe(5);
  });

  it('records a reuse when the earlier upload was the same person and file name', async () => {
    const existing = coreUpload(TEXT, { uploadedBy: ALICE, fileName: 'voice.txt' });

    const { document } = await addProjectDocument('p1', fileSource(), ALICE);

    expect(linkOf(document.id)).toMatchObject({
      knowledgeDocumentId: existing.id,
      createdByUpload: false,
    });
  });

  it('records a reuse when a racing upload by someone else made the row during the call', async () => {
    upload.during = () => coreUpload(TEXT, { uploadedBy: BOB });

    const { document } = await addProjectDocument('p1', fileSource(), ALICE);

    expect(linkOf(document.id)?.createdByUpload).toBe(false);
  });

  it('reads a page through fetchPage and records where it came from', async () => {
    fetchPage.mockResolvedValue({
      text: TEXT,
      title: 'About us',
      url: 'https://example.com/about/',
      wordCount: 10,
      format: 'html',
      warnings: [],
    });

    const { document } = await addProjectDocument(
      'p1',
      { source: { url: 'https://example.com/about' } },
      ALICE
    );

    expect(fetchPage).toHaveBeenCalledWith('https://example.com/about', expect.anything());
    expect(uploadDocument).toHaveBeenCalledWith(
      TEXT,
      'example.com-about.html',
      ALICE,
      'https://example.com/about/',
      'About us'
    );
    expect(linkOf(document.id)).toMatchObject({
      title: 'About us',
      fileName: null,
      sourceUrl: 'https://example.com/about/',
      createdByUpload: true,
    });
  });

  it('answers the existing link when the project already holds the same text', async () => {
    const first = await addProjectDocument('p1', fileSource(), ALICE);
    const second = await addProjectDocument('p1', fileSource(TEXT, 'copy-of-voice.txt'), BOB);

    expect(second.added).toBe(false);
    expect(second.document.id).toBe(first.document.id);
    expect(second.document.title).toBe(first.document.title);
    expect(db.state.links).toHaveLength(1);
    // Answered from the link: the text is not indexed again.
    expect(uploadDocument).toHaveBeenCalledTimes(1);
  });

  it('renames the existing link when the same text is added again with a title', async () => {
    const first = await addProjectDocument('p1', fileSource(), ALICE);
    const second = await addProjectDocument(
      'p1',
      { ...fileSource(), title: 'Brand voice 2026' },
      ALICE
    );

    expect(second).toMatchObject({
      added: false,
      document: { id: first.document.id, title: 'Brand voice 2026' },
    });
    expect(linkOf(first.document.id)?.title).toBe('Brand voice 2026');
  });

  it('answers the existing link, not the cap, when a full project is given text it holds', async () => {
    const first = await addProjectDocument('p1', fileSource(), ALICE);
    for (let i = 1; i < MAX_PROJECT_DOCUMENTS; i++) {
      db.state.links.push({ id: `l${i}`, orgId: 'org-a', projectId: 'p1' });
    }

    const again = await addProjectDocument('p1', fileSource(), ALICE);

    expect(again).toMatchObject({ added: false, document: { id: first.document.id } });
    expect(uploadDocument).toHaveBeenCalledTimes(1);
  });

  it('indexes the text again when the row the project links to has failed', async () => {
    const first = await addProjectDocument('p1', fileSource(), ALICE);
    const row = db.state.knowledge.find(
      (k) => k.id === linkOf(first.document.id)?.knowledgeDocumentId
    );
    if (row) row.status = 'failed';

    await addProjectDocument('p1', fileSource(), ALICE);

    expect(uploadDocument).toHaveBeenCalledTimes(2);
  });

  it('keeps that it made the row when a racing add to the same project linked it first', async () => {
    const projectDocument = (tables.current as { projectDocument: ReturnType<typeof linkTable> })
      .projectDocument;
    // The other request links the row between this one's read and its create.
    projectDocument.findFirst.mockImplementationOnce(async () => {
      db.state.links.push({
        id: 'link-raced',
        orgId: 'org-a',
        projectId: 'p1',
        knowledgeDocumentId: db.state.knowledge[0].id,
        title: 'voice',
        fileName: 'voice.txt',
        sourceUrl: null,
        createdByUpload: false,
        createdAt: new Date(),
      });
      return null;
    });

    const { document, added } = await addProjectDocument('p1', fileSource(), ALICE);

    expect(added).toBe(false);
    expect(document.id).toBe('link-raced');
    expect(linkOf('link-raced')?.createdByUpload).toBe(true);
  });

  it('says to try again when the row is deleted between indexing and linking', async () => {
    upload.during = null;
    const projectDocument = (tables.current as { projectDocument: ReturnType<typeof linkTable> })
      .projectDocument;
    projectDocument.findFirst.mockImplementationOnce(async () => {
      db.state.knowledge = [];
      return null;
    });

    await expect(addProjectDocument('p1', fileSource(), ALICE)).rejects.toMatchObject({
      code: 'DOCUMENT_CHANGED',
      status: 409,
    });
  });

  it('deletes the failed row its own upload left, and says it could not index', async () => {
    const someoneElses = coreUpload('other text', { status: 'failed' });
    upload.fail = true;

    await expect(addProjectDocument('p1', fileSource(), ALICE)).rejects.toMatchObject({
      code: 'DOCUMENT_NOT_INDEXED',
      status: 502,
    });
    expect(db.state.knowledge.map((r) => r.id)).toEqual([someoneElses.id]);
    expect(db.state.links).toEqual([]);
  });

  it('keeps a failed row a racing add has already linked, so its link is not cascaded away', async () => {
    upload.fail = true;
    const projectDocument = (tables.current as { projectDocument: ReturnType<typeof linkTable> })
      .projectDocument;
    // Another project's add was handed this row by core's slug race and linked it.
    projectDocument.findMany.mockImplementationOnce(async ({ where }: { where: Row }) => {
      db.state.links.push({
        id: 'link-b',
        orgId: 'org-a',
        projectId: 'p2',
        knowledgeDocumentId: db.state.knowledge[0].id,
      });
      return db.state.links.filter((r) => matches(r, where));
    });

    await expect(addProjectDocument('p1', fileSource(), ALICE)).rejects.toMatchObject({
      code: 'DOCUMENT_NOT_INDEXED',
    });
    expect(db.state.knowledge).toHaveLength(1);
    expect(linkOf('link-b')).toBeDefined();
  });

  it("never links another workspace's knowledge row that core's dedupe hands back", async () => {
    coreUpload(TEXT, { orgId: 'org-b' });

    await expect(addProjectDocument('p1', fileSource(), ALICE)).rejects.toMatchObject({
      code: 'DOCUMENT_NOT_INDEXED',
      status: 502,
    });
    expect(db.state.links).toEqual([]);
    expect(db.state.knowledge).toHaveLength(1);
  });

  it("cuts a document's own title to the length a given one may be", async () => {
    const long = 'T'.repeat(500);
    const { document } = await addProjectDocument(
      'p1',
      fileSource(`# ${long}\n\n${TEXT}`, 'long.md'),
      ALICE
    );

    expect(document.title).toBe('T'.repeat(200));
  });

  it('refuses a document longer than a background document may be, in its own words', async () => {
    await expect(
      addProjectDocument('p1', fileSource('word '.repeat(50_000)), ALICE)
    ).rejects.toMatchObject({
      code: 'TEXT_TOO_LONG',
      status: 422,
      message: expect.stringContaining('background document'),
    });
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it('refuses another document once the project holds the most it may', async () => {
    for (let i = 0; i < MAX_PROJECT_DOCUMENTS; i++) {
      db.state.links.push({ id: `l${i}`, orgId: 'org-a', projectId: 'p1' });
    }

    await expect(addProjectDocument('p1', fileSource(), ALICE)).rejects.toMatchObject({
      code: 'TOO_MANY_DOCUMENTS',
      status: 409,
    });
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it('refuses an archived project before reading anything', async () => {
    db.state.projects[0].archivedAt = new Date();

    await expect(addProjectDocument('p1', fileSource(), ALICE)).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVED',
      status: 409,
    });
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it("is not found for another workspace's project, and reads nothing", async () => {
    await expect(addProjectDocument('p-other', fileSource(), ALICE)).rejects.toMatchObject({
      status: 404,
    });
    expect(uploadDocument).not.toHaveBeenCalled();
  });
});

describe('listProjectDocuments', () => {
  it("lists the project's links oldest first, each with its knowledge row's live status", async () => {
    const a = await addProjectDocument('p1', fileSource('First text.', 'a.txt'), ALICE);
    await addProjectDocument('p2', fileSource('Second text.', 'b.txt'), ALICE);
    const c = await addProjectDocument('p1', fileSource('Third text.', 'c.txt'), ALICE);
    // Core re-processes one.
    const row = db.state.knowledge.find((k) => k.id === linkOf(c.document.id)?.knowledgeDocumentId);
    if (row) row.status = 'processing';

    const listed = await listProjectDocuments('p1');

    expect(listed.map((d) => [d.id, d.status])).toEqual([
      [a.document.id, 'ready'],
      [c.document.id, 'processing'],
    ]);
  });

  it("is not found for another workspace's project", async () => {
    await expect(listProjectDocuments('p-other')).rejects.toMatchObject({ status: 404 });
  });
});

describe('removeProjectDocument', () => {
  it('deletes the knowledge row when its only link goes and the app made it', async () => {
    const { document } = await addProjectDocument('p1', fileSource(), ALICE);

    const removed = await removeProjectDocument('p1', document.id);

    expect(removed).toEqual({ id: document.id, knowledgeDocumentDeleted: true });
    expect(db.state.knowledge).toEqual([]);
    expect(db.state.links).toEqual([]);
    expect(invalidateAllAgentAccess).toHaveBeenCalled();
  });

  it('keeps a document two projects share until the last link goes, whichever goes first', async () => {
    const first = await addProjectDocument('p1', fileSource(), ALICE);
    const second = await addProjectDocument('p2', fileSource(), BOB);
    expect(linkOf(first.document.id)?.createdByUpload).toBe(true);
    expect(linkOf(second.document.id)?.createdByUpload).toBe(false);

    // The link that made it goes first: only the link goes, and the other now holds the fact.
    expect(await removeProjectDocument('p1', first.document.id)).toEqual({
      id: first.document.id,
      knowledgeDocumentDeleted: false,
    });
    expect(db.state.knowledge).toHaveLength(1);
    expect(linkOf(second.document.id)?.createdByUpload).toBe(true);

    expect(await removeProjectDocument('p2', second.document.id)).toEqual({
      id: second.document.id,
      knowledgeDocumentDeleted: true,
    });
    expect(db.state.knowledge).toEqual([]);
  });

  it("never deletes a document first uploaded through core's knowledge page", async () => {
    const core = coreUpload(TEXT);
    const { document } = await addProjectDocument('p1', fileSource(), ALICE);

    const removed = await removeProjectDocument('p1', document.id);

    expect(removed.knowledgeDocumentDeleted).toBe(false);
    expect(db.state.knowledge.map((r) => r.id)).toEqual([core.id]);
    expect(db.state.links).toEqual([]);
    expect(invalidateAllAgentAccess).not.toHaveBeenCalled();
  });

  it('keeps a document the app made when an agent is granted it directly', async () => {
    const { document } = await addProjectDocument('p1', fileSource(), ALICE);
    db.state.directGrants.push(String(linkOf(document.id)?.knowledgeDocumentId));

    const removed = await removeProjectDocument('p1', document.id);

    expect(removed.knowledgeDocumentDeleted).toBe(false);
    expect(db.state.knowledge).toHaveLength(1);
    expect(db.state.links).toEqual([]);
  });

  it('keeps a document the app made once it carries a tag, granted to an agent or not', async () => {
    const { document } = await addProjectDocument('p1', fileSource(), ALICE);
    db.state.taggedDocs.push(String(linkOf(document.id)?.knowledgeDocumentId));

    const removed = await removeProjectDocument('p1', document.id);

    expect(removed.knowledgeDocumentDeleted).toBe(false);
    expect(db.state.knowledge).toHaveLength(1);
  });

  it('keeps a row the app made while it is still being embedded, for the add that may hold it', async () => {
    const { document } = await addProjectDocument('p1', fileSource(), ALICE);
    const row = db.state.knowledge.find((k) => k.id === linkOf(document.id)?.knowledgeDocumentId);
    if (row) row.status = 'processing';

    const removed = await removeProjectDocument('p1', document.id);

    expect(removed.knowledgeDocumentDeleted).toBe(false);
    expect(db.state.knowledge).toHaveLength(1);
    expect(db.state.links).toEqual([]);
  });

  it('runs as one serializable transaction, and tries again when it clashes', async () => {
    const { document } = await addProjectDocument('p1', fileSource(), ALICE);
    const client = tables.current as { $transaction: ReturnType<typeof vi.fn> };
    client.$transaction.mockRejectedValueOnce(serializable());

    const removed = await removeProjectDocument('p1', document.id);

    expect(removed.knowledgeDocumentDeleted).toBe(true);
    expect(client.$transaction).toHaveBeenCalledTimes(2);
    expect(client.$transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it("is not found for another project's link, or another workspace's project", async () => {
    const { document } = await addProjectDocument('p1', fileSource(), ALICE);

    await expect(removeProjectDocument('p2', document.id)).rejects.toMatchObject({ status: 404 });
    await expect(removeProjectDocument('p-other', document.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(db.state.links).toHaveLength(1);
  });
});

describe('PROJECT_DOCUMENT_UNIQUE', () => {
  it('names the index the migration made, so a renamed index fails here rather than as a 500', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(
      'prisma/migrations/20261123100000_app_project_document/migration.sql',
      'utf8'
    );

    expect(sql).toContain(
      `CREATE UNIQUE INDEX "${PROJECT_DOCUMENT_UNIQUE.index}" ON "app_project_document"("projectId", "knowledgeDocumentId")`
    );
  });
});
