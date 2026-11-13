/**
 * An in-memory FrameworkRepo for the store's tests: stateful, so import,
 * publish and materialise can be driven end to end without a database. It
 * keeps the real repo's one load-bearing rule — a write to an existing
 * version happens only while it is a draft — so the store's own checks are
 * tested against the same contract.
 */
import type {
  FrameworkHeader,
  FrameworkRepo,
  StoredVersion,
  VersionContent,
} from '@/lib/app/frameworks/repo';
import type { LinkRecord, NodeRecord } from '@/lib/app/frameworks/types';
import type {
  FrameworkCatalog,
  ServedFramework,
  ServedVersion,
} from '@/lib/app/frameworks/api/catalog';

export interface FakeVersion extends StoredVersion {
  nodes: NodeRecord[];
  links: LinkRecord[];
  sourceDocument: unknown;
}

export class FakeFrameworkRepo implements FrameworkRepo {
  readonly frameworks = new Map<string, FrameworkHeader>();
  readonly versions = new Map<string, FakeVersion>();
  readonly calls = { createDraft: 0, replaceDraft: 0, markPublished: 0, readNodes: 0 };
  private nextId = 1;

  private byNumber(slug: string, version: string): FakeVersion | undefined {
    return [...this.versions.values()].find(
      (v) => v.frameworkSlug === slug && v.version === version
    );
  }

  private stored(v: FakeVersion): StoredVersion {
    const { nodes: _n, links: _l, sourceDocument: _d, ...rest } = v;
    return { ...rest };
  }

  findVersion(slug: string, version: string): Promise<StoredVersion | null> {
    const v = this.byNumber(slug, version);
    return Promise.resolve(v ? this.stored(v) : null);
  }

  findVersionById(versionId: string): Promise<StoredVersion | null> {
    const v = this.versions.get(versionId);
    return Promise.resolve(v ? this.stored(v) : null);
  }

  createDraft(framework: FrameworkHeader, content: VersionContent): Promise<StoredVersion> {
    this.calls.createDraft++;
    if (!this.frameworks.has(framework.slug)) this.frameworks.set(framework.slug, framework);
    const v: FakeVersion = {
      id: `v${this.nextId++}`,
      frameworkSlug: framework.slug,
      version: content.version,
      schemaVersion: content.schemaVersion,
      status: 'DRAFT',
      sourceSha256: content.sourceSha256,
      publishedAt: null,
      sourceDocument: content.sourceDocument,
      // Stored as JSON, as the database would.
      nodes: JSON.parse(JSON.stringify(content.nodes)) as NodeRecord[],
      links: [...content.links],
    };
    this.versions.set(v.id, v);
    return Promise.resolve(this.stored(v));
  }

  replaceDraft(versionId: string, content: VersionContent): Promise<boolean> {
    this.calls.replaceDraft++;
    const v = this.versions.get(versionId);
    if (!v || v.status !== 'DRAFT') return Promise.resolve(false);
    Object.assign(v, {
      schemaVersion: content.schemaVersion,
      sourceSha256: content.sourceSha256,
      sourceDocument: content.sourceDocument,
      nodes: JSON.parse(JSON.stringify(content.nodes)) as NodeRecord[],
      links: [...content.links],
    });
    return Promise.resolve(true);
  }

  markPublished(versionId: string, at: Date): Promise<boolean> {
    this.calls.markPublished++;
    const v = this.versions.get(versionId);
    if (!v || v.status !== 'DRAFT') return Promise.resolve(false);
    v.status = 'PUBLISHED';
    v.publishedAt = at;
    return Promise.resolve(true);
  }

  readNodes(versionId: string): Promise<NodeRecord[]> {
    this.calls.readNodes++;
    const v = this.versions.get(versionId);
    // Shuffled, so compose() is proved to order by position, not by storage.
    return Promise.resolve(v ? [...v.nodes].reverse() : []);
  }
}

/**
 * The public catalog over a fake repo's state, with the real one's rules: a
 * draft is never listed, and a framework with nothing published is absent.
 */
export function fakeCatalog(repo: FakeFrameworkRepo): FrameworkCatalog {
  const served = (slug: string): ServedFramework | null => {
    const header = repo.frameworks.get(slug);
    const versions = [...repo.versions.values()]
      .filter((v) => v.frameworkSlug === slug && v.status !== 'DRAFT')
      .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
      .map(
        (v): ServedVersion => ({
          id: v.id,
          version: v.version,
          schemaVersion: v.schemaVersion,
          status: v.status === 'RETIRED' ? 'RETIRED' : 'PUBLISHED',
          publishedAt: v.publishedAt,
          sourceSha256: v.sourceSha256,
        })
      );
    return header && versions.length ? { ...header, versions } : null;
  };
  return {
    listFrameworks: () =>
      Promise.resolve(
        [...repo.frameworks.keys()].sort().flatMap((slug) => served(slug) ?? [])
      ),
    findFramework: (slug) => Promise.resolve(served(slug)),
  };
}
