/**
 * The frameworks and versions the public API may show (t-11).
 *
 * Read-only. A draft is never listed: a framework appears once it has a
 * version that has been published, and a version once it is published or
 * retired. A retired version stays readable because assessments made with it
 * keep citing it (app-plan §8.1).
 *
 * These are shared-config tables with no tenant-owned relation, so the read
 * needs no org scope and works for an anonymous caller at `multi`.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

export type ServedVersionStatus = 'PUBLISHED' | 'RETIRED';

export interface ServedVersion {
  id: string;
  version: string;
  schemaVersion: string;
  status: ServedVersionStatus;
  publishedAt: Date | null;
  sourceSha256: string;
}

export interface ServedFramework {
  slug: string;
  name: string;
  summary: string;
  /** Newest first. Never empty. */
  versions: ServedVersion[];
}

export interface FrameworkCatalog {
  listFrameworks(): Promise<ServedFramework[]>;
  findFramework(slug: string): Promise<ServedFramework | null>;
}

const SERVED = {
  status: { in: ['PUBLISHED', 'RETIRED'] },
} satisfies Prisma.FrameworkVersionWhereInput;

const frameworkSelect = {
  slug: true,
  name: true,
  summary: true,
  versions: {
    where: SERVED,
    orderBy: [{ publishedAt: 'desc' as const }, { createdAt: 'desc' as const }],
    select: {
      id: true,
      version: true,
      schemaVersion: true,
      status: true,
      publishedAt: true,
      sourceSha256: true,
    },
  },
} satisfies Prisma.FrameworkSelect;

function toServed(row: {
  slug: string;
  name: string;
  summary: string;
  versions: Array<Omit<ServedVersion, 'status'> & { status: string }>;
}): ServedFramework | null {
  const versions = row.versions.flatMap((v): ServedVersion[] => {
    const { status } = v;
    return status === 'PUBLISHED' || status === 'RETIRED' ? [{ ...v, status }] : [];
  });
  return versions.length
    ? { slug: row.slug, name: row.name, summary: row.summary, versions }
    : null;
}

export const prismaFrameworkCatalog: FrameworkCatalog = {
  async listFrameworks() {
    const rows = await prisma.framework.findMany({
      where: { versions: { some: SERVED } },
      select: frameworkSelect,
      orderBy: { slug: 'asc' },
    });
    return rows.flatMap((row) => toServed(row) ?? []);
  },

  async findFramework(slug) {
    const row = await prisma.framework.findUnique({ where: { slug }, select: frameworkSelect });
    return row ? toServed(row) : null;
  },
};
