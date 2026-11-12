/**
 * The Prisma repo (t-10): every write that could touch an existing version is
 * conditioned on it still being a draft, in the statement itself, and a
 * version's records and links are written together, links by the ids of the
 * records they join. Prisma is mocked; the smoke script runs it for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LinkRecord, NodeRecord } from '@/lib/app/frameworks/types';

const tx = vi.hoisted(() => ({
  framework: { upsert: vi.fn() },
  frameworkVersion: { create: vi.fn(), updateMany: vi.fn() },
  frameworkNode: { createMany: vi.fn(), deleteMany: vi.fn() },
  frameworkLink: { createMany: vi.fn(), deleteMany: vi.fn() },
}));
const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  frameworkVersion: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  frameworkNode: { findMany: vi.fn() },
}));
vi.mock('@/lib/db/client', () => ({ prisma: db }));

import { prismaFrameworkRepo as repo } from '@/lib/app/frameworks/repo';

const row = {
  id: 'ver-1',
  version: '0.5.1',
  schemaVersion: '4',
  status: 'DRAFT' as const,
  sourceSha256: 'abc',
  publishedAt: null,
  framework: { slug: 'howdoesthisland' },
};
const stored = {
  id: 'ver-1',
  frameworkSlug: 'howdoesthisland',
  version: '0.5.1',
  schemaVersion: '4',
  status: 'DRAFT',
  sourceSha256: 'abc',
  publishedAt: null,
};

const node = (kind: string, key: string): NodeRecord => ({
  kind,
  key,
  parentKey: null,
  name: key,
  position: 0,
  attributes: { id: key },
});
const link: LinkRecord = {
  fromKind: 'move',
  fromKey: 'mv_a',
  toKind: 'dimension',
  toKey: 'dim_b',
  relation: 'dimension',
};
const content = {
  version: '0.5.1',
  schemaVersion: '4',
  sourceDocument: { meta: {} },
  sourceSha256: 'abc',
  nodes: [node('move', 'mv_a'), node('dimension', 'dim_b')],
  links: [link],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
  tx.framework.upsert.mockResolvedValue({ id: 'fw-1' });
  tx.frameworkVersion.create.mockResolvedValue(row);
});

describe('reads', () => {
  it('finds a version by framework slug and number', async () => {
    db.frameworkVersion.findFirst.mockResolvedValue(row);
    expect(await repo.findVersion('howdoesthisland', '0.5.1')).toEqual(stored);
    expect(db.frameworkVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { version: '0.5.1', framework: { slug: 'howdoesthisland' } },
      })
    );
  });

  it('answers null for a version that does not exist', async () => {
    db.frameworkVersion.findFirst.mockResolvedValue(null);
    db.frameworkVersion.findUnique.mockResolvedValue(null);
    expect(await repo.findVersion('howdoesthisland', '9.9.9')).toBeNull();
    expect(await repo.findVersionById('nope')).toBeNull();
  });

  it('finds a version by id', async () => {
    db.frameworkVersion.findUnique.mockResolvedValue(row);
    expect(await repo.findVersionById('ver-1')).toEqual(stored);
  });

  it('reads a version’s records', async () => {
    db.frameworkNode.findMany.mockResolvedValue([node('move', 'mv_a')]);
    expect(await repo.readNodes('ver-1')).toEqual([node('move', 'mv_a')]);
    expect(db.frameworkNode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { versionId: 'ver-1' } })
    );
  });
});

describe('createDraft()', () => {
  it('creates the framework if new, then the draft and its records, in one transaction', async () => {
    const header = { slug: 'howdoesthisland', name: 'HowDoesThisLand', summary: 's' };
    expect(await repo.createDraft(header, content)).toEqual(stored);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    // An existing framework's name and summary are left as they are.
    expect(tx.framework.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'howdoesthisland' }, create: header, update: {} })
    );
    expect(tx.frameworkVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          frameworkId: 'fw-1',
          version: '0.5.1',
          sourceSha256: 'abc',
        }),
      })
    );
  });

  it('writes each link between the ids given to the records it joins', async () => {
    await repo.createDraft({ slug: 'f', name: 'F', summary: 's' }, content);
    const nodes = (
      tx.frameworkNode.createMany.mock.calls[0]![0] as {
        data: { id: string; key: string; versionId: string }[];
      }
    ).data;
    const ids = Object.fromEntries(nodes.map((n) => [n.key, n.id]));
    expect(nodes.every((n) => n.versionId === 'ver-1')).toBe(true);
    expect(tx.frameworkLink.createMany).toHaveBeenCalledWith({
      data: [
        { versionId: 'ver-1', fromNodeId: ids.mv_a, toNodeId: ids.dim_b, relation: 'dimension' },
      ],
    });
  });

  it('refuses a link to a record not in the version', async () => {
    const orphan = { ...content, links: [{ ...link, toKey: 'missing' }] };
    await expect(repo.createDraft({ slug: 'f', name: 'F', summary: 's' }, orphan)).rejects.toThrow(
      'link to a record not in this version: dimension missing'
    );
    expect(tx.frameworkLink.createMany).not.toHaveBeenCalled();
  });
});

describe('replaceDraft()', () => {
  it('claims the version only while it is a draft, then rewrites its records', async () => {
    tx.frameworkVersion.updateMany.mockResolvedValue({ count: 1 });
    expect(await repo.replaceDraft('ver-1', content)).toBe(true);
    expect(tx.frameworkVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ver-1', status: 'DRAFT' } })
    );
    expect(tx.frameworkLink.deleteMany).toHaveBeenCalledWith({ where: { versionId: 'ver-1' } });
    expect(tx.frameworkNode.deleteMany).toHaveBeenCalledWith({ where: { versionId: 'ver-1' } });
    expect(tx.frameworkNode.createMany).toHaveBeenCalled();
  });

  it('deletes and writes nothing once the version is no longer a draft', async () => {
    tx.frameworkVersion.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.replaceDraft('ver-1', content)).toBe(false);
    expect(tx.frameworkLink.deleteMany).not.toHaveBeenCalled();
    expect(tx.frameworkNode.deleteMany).not.toHaveBeenCalled();
    expect(tx.frameworkNode.createMany).not.toHaveBeenCalled();
  });
});

describe('markPublished()', () => {
  it('publishes only a draft', async () => {
    const at = new Date('2026-11-12T12:00:00Z');
    db.frameworkVersion.updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await repo.markPublished('ver-1', at)).toBe(true);
    expect(db.frameworkVersion.updateMany).toHaveBeenCalledWith({
      where: { id: 'ver-1', status: 'DRAFT' },
      data: { status: 'PUBLISHED', publishedAt: at },
    });

    db.frameworkVersion.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await repo.markPublished('ver-1', at)).toBe(false);
  });
});
