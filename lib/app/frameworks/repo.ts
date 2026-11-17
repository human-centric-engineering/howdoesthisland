/**
 * The framework tables' only writer (t-10).
 *
 * Every write to `Framework`, `FrameworkVersion`, `FrameworkNode` and
 * `FrameworkLink` is in this file, and a guard test
 * (`tests/unit/lib/app/frameworks/write-guard.test.ts`) fails if any other
 * file writes them. Each write that could touch an existing version is
 * conditioned on that version still being a draft, in the same statement, so
 * a published version cannot change even if a caller skips the store's own
 * check.
 *
 * These are shared-config tables (`globalConfig`): at `multi` the caller runs
 * in the system scope (the import and publish scripts do).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import type { JsonObject, LinkRecord, NodeRecord } from '@/lib/app/frameworks/types';

export type VersionStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';

export interface StoredVersion {
  id: string;
  frameworkSlug: string;
  version: string;
  schemaVersion: string;
  status: VersionStatus;
  sourceSha256: string;
  publishedAt: Date | null;
}

export interface VersionContent {
  version: string;
  schemaVersion: string;
  sourceDocument: unknown;
  sourceSha256: string;
  nodes: readonly NodeRecord[];
  links: readonly LinkRecord[];
}

export interface FrameworkHeader {
  slug: string;
  name: string;
  summary: string;
}

/** What the store needs from the database. The tests give it an in-memory one. */
export interface FrameworkRepo {
  findVersion(slug: string, version: string): Promise<StoredVersion | null>;
  findVersionById(versionId: string): Promise<StoredVersion | null>;
  /** Creates the framework if new, and the version as a draft with its records. */
  createDraft(framework: FrameworkHeader, content: VersionContent): Promise<StoredVersion>;
  /** Replaces a draft's records. Returns false if the version is no longer a draft. */
  replaceDraft(versionId: string, content: VersionContent): Promise<boolean>;
  /**
   * Draft → published, recording `calibration` (t-37). Returns false if the
   * version is no longer a draft, or no longer has the file `sourceSha256`.
   */
  markPublished(
    versionId: string,
    at: Date,
    sourceSha256: string,
    calibration: JsonObject | null
  ): Promise<boolean>;
  readNodes(versionId: string): Promise<NodeRecord[]>;
  /**
   * The most recently published version of the framework that recorded a
   * calibration snapshot, and that snapshot unparsed (t-40), or null. Retired
   * versions are not considered.
   */
  lastPublishedCalibration(slug: string): Promise<{ version: string; calibration: unknown } | null>;
}

/** Long enough for ~700 records and ~1,500 links in one transaction. */
const WRITE_TIMEOUT_MS = 60_000;

function toStored(row: {
  id: string;
  version: string;
  schemaVersion: string;
  status: VersionStatus;
  sourceSha256: string;
  publishedAt: Date | null;
  framework: { slug: string };
}): StoredVersion {
  return {
    id: row.id,
    frameworkSlug: row.framework.slug,
    version: row.version,
    schemaVersion: row.schemaVersion,
    status: row.status,
    sourceSha256: row.sourceSha256,
    publishedAt: row.publishedAt,
  };
}

const versionSelect = {
  id: true,
  version: true,
  schemaVersion: true,
  status: true,
  sourceSha256: true,
  publishedAt: true,
  framework: { select: { slug: true } },
} as const;

async function writeRecords(
  tx: Prisma.TransactionClient,
  versionId: string,
  content: VersionContent
): Promise<void> {
  const ids = new Map<string, string>();
  const nodeRows = content.nodes.map((node) => {
    const id = globalThis.crypto.randomUUID();
    ids.set(`${node.kind}\u0000${node.key}`, id);
    return {
      id,
      versionId,
      kind: node.kind,
      key: node.key,
      parentKey: node.parentKey,
      name: node.name,
      position: node.position,
      attributes: node.attributes as Prisma.InputJsonValue,
    };
  });
  await tx.frameworkNode.createMany({ data: nodeRows });

  const linkRows = content.links.map((link) => {
    const fromNodeId = ids.get(`${link.fromKind}\u0000${link.fromKey}`);
    const toNodeId = ids.get(`${link.toKind}\u0000${link.toKey}`);
    if (!fromNodeId || !toNodeId) {
      // decompose() only emits links between records it also emits.
      throw new Error(`link to a record not in this version: ${link.toKind} ${link.toKey}`);
    }
    return { versionId, fromNodeId, toNodeId, relation: link.relation };
  });
  await tx.frameworkLink.createMany({ data: linkRows });
}

export const prismaFrameworkRepo: FrameworkRepo = {
  async findVersion(slug, version) {
    const row = await prisma.frameworkVersion.findFirst({
      where: { version, framework: { slug } },
      select: versionSelect,
    });
    return row ? toStored(row) : null;
  },

  async findVersionById(versionId) {
    const row = await prisma.frameworkVersion.findUnique({
      where: { id: versionId },
      select: versionSelect,
    });
    return row ? toStored(row) : null;
  },

  async createDraft(framework, content) {
    return prisma.$transaction(
      async (tx) => {
        const fw = await tx.framework.upsert({
          where: { slug: framework.slug },
          create: framework,
          update: {},
          select: { id: true },
        });
        const row = await tx.frameworkVersion.create({
          data: {
            frameworkId: fw.id,
            version: content.version,
            schemaVersion: content.schemaVersion,
            sourceDocument: content.sourceDocument as Prisma.InputJsonValue,
            sourceSha256: content.sourceSha256,
          },
          select: versionSelect,
        });
        await writeRecords(tx, row.id, content);
        return toStored(row);
      },
      { timeout: WRITE_TIMEOUT_MS }
    );
  },

  async replaceDraft(versionId, content) {
    return prisma.$transaction(
      async (tx) => {
        // Conditioned on DRAFT in the same statement as the write.
        const claimed = await tx.frameworkVersion.updateMany({
          where: { id: versionId, status: 'DRAFT' },
          data: {
            schemaVersion: content.schemaVersion,
            sourceDocument: content.sourceDocument as Prisma.InputJsonValue,
            sourceSha256: content.sourceSha256,
          },
        });
        if (claimed.count === 0) return false;
        await tx.frameworkLink.deleteMany({ where: { versionId } });
        await tx.frameworkNode.deleteMany({ where: { versionId } });
        await writeRecords(tx, versionId, content);
        return true;
      },
      { timeout: WRITE_TIMEOUT_MS }
    );
  },

  async markPublished(versionId, at, sourceSha256, calibration) {
    const result = await prisma.frameworkVersion.updateMany({
      where: { id: versionId, status: 'DRAFT', sourceSha256 },
      data: {
        status: 'PUBLISHED',
        publishedAt: at,
        ...(calibration ? { calibration: calibration as Prisma.InputJsonValue } : {}),
      },
    });
    return result.count === 1;
  },

  async readNodes(versionId) {
    return prisma.frameworkNode.findMany({
      where: { versionId },
      select: {
        kind: true,
        key: true,
        parentKey: true,
        name: true,
        position: true,
        attributes: true,
      },
      orderBy: [{ kind: 'asc' }, { position: 'asc' }],
    });
  },

  async lastPublishedCalibration(slug) {
    // A framework has a handful of versions: filtering SQL NULL in JS avoids `Prisma.DbNull`.
    const rows = await prisma.frameworkVersion.findMany({
      where: { status: 'PUBLISHED', framework: { slug } },
      select: { version: true, calibration: true },
      // Deterministic on ties; a row with no publishedAt is never "the last".
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    const row = rows.find((r) => r.calibration !== null);
    return row ? { version: row.version, calibration: row.calibration } : null;
  },
};
