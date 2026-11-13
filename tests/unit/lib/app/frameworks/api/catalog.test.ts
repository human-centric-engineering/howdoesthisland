/**
 * The public catalog's queries (t-11): a draft must never reach the API, so
 * the filter is asserted where it is written, in the query, and the mapping
 * drops a framework left with nothing to serve.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  framework: { findMany: vi.fn(), findUnique: vi.fn() },
}));
vi.mock('@/lib/db/client', () => ({ prisma: mockPrisma }));

import { prismaFrameworkCatalog } from '@/lib/app/frameworks/api/catalog';

const SERVED_ONLY = { status: { in: ['PUBLISHED', 'RETIRED'] } };

const published = {
  id: 'v1',
  version: '0.5.1',
  schemaVersion: '4',
  status: 'PUBLISHED',
  publishedAt: new Date('2026-11-12T21:50:46Z'),
  sourceSha256: 'abc',
};
const row = (versions: unknown[]) => ({ slug: 'hdtl', name: 'H', summary: 'S', versions });

beforeEach(() => {
  mockPrisma.framework.findMany.mockReset();
  mockPrisma.framework.findUnique.mockReset();
});

describe('listFrameworks', () => {
  it('asks only for frameworks with a published or retired version, and only those versions', async () => {
    mockPrisma.framework.findMany.mockResolvedValue([row([published])]);
    const result = await prismaFrameworkCatalog.listFrameworks();

    const args = mockPrisma.framework.findMany.mock.calls[0][0] as {
      where: unknown;
      select: { versions: { where: unknown } };
    };
    expect(args.where).toEqual({ versions: { some: SERVED_ONLY } });
    expect(args.select.versions.where).toEqual(SERVED_ONLY);
    expect(result).toEqual([{ slug: 'hdtl', name: 'H', summary: 'S', versions: [published] }]);
  });
});

describe('findFramework', () => {
  it('filters the versions it reads to published and retired', async () => {
    mockPrisma.framework.findUnique.mockResolvedValue(row([published]));
    await prismaFrameworkCatalog.findFramework('hdtl');
    const args = mockPrisma.framework.findUnique.mock.calls[0][0] as {
      where: unknown;
      select: { versions: { where: unknown } };
    };
    expect(args.where).toEqual({ slug: 'hdtl' });
    expect(args.select.versions.where).toEqual(SERVED_ONLY);
  });

  it('answers null for no framework, and for one with nothing published', async () => {
    mockPrisma.framework.findUnique.mockResolvedValueOnce(null);
    expect(await prismaFrameworkCatalog.findFramework('nope')).toBeNull();
    mockPrisma.framework.findUnique.mockResolvedValueOnce(row([]));
    expect(await prismaFrameworkCatalog.findFramework('hdtl')).toBeNull();
  });

  it('drops a version whose status is not one it serves, as a second guard', async () => {
    mockPrisma.framework.findUnique.mockResolvedValue(
      row([published, { ...published, id: 'v2', version: '0.6.0', status: 'DRAFT' }])
    );
    const fw = await prismaFrameworkCatalog.findFramework('hdtl');
    expect(fw?.versions.map((v) => v.version)).toEqual(['0.5.1']);
  });
});
