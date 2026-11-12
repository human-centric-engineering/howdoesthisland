/**
 * The framework store end to end on an in-memory repo (t-10): import,
 * idempotence, refusal, publish, immutability and materialise.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import {
  FrameworkStoreError,
  __resetMaterialiseCacheForTests,
  importVersion,
  materialise,
  publishVersion,
  sha256,
} from '@/lib/app/frameworks/store';
import type { JsonObject } from '@/lib/app/frameworks/types';
import { FakeFrameworkRepo } from '@/tests/unit/lib/app/frameworks/fake-repo';

const RAW = readFileSync('lib/app/frameworks/howdoesthisland/data/model-0.5.1.json', 'utf8');
const RAW_0_5_0 = readFileSync('tests/unit/lib/app/frameworks/fixtures/model-0.5.0.json', 'utf8');

/** 0.5.1 with one appeal renamed: the same version number, different bytes. */
function edited(name = 'Edited'): string {
  const doc = JSON.parse(RAW) as { appeals: JsonObject[] };
  doc.appeals[0]!.name = name;
  return JSON.stringify(doc);
}

async function refusal(promise: Promise<unknown>): Promise<FrameworkStoreError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e
  );
  if (!(err instanceof FrameworkStoreError))
    throw new Error(`expected a refusal, got ${String(err)}`);
  return err;
}

let repo: FakeFrameworkRepo;
beforeEach(() => {
  repo = new FakeFrameworkRepo();
  __resetMaterialiseCacheForTests();
});

describe('importVersion()', () => {
  it('creates a draft from 0.5.1, with its records, links and checksum', async () => {
    const result = await importVersion(repo, howDoesThisLand, RAW);
    expect(result.outcome).toBe('created');
    expect(result.version).toMatchObject({
      frameworkSlug: 'howdoesthisland',
      version: '0.5.1',
      schemaVersion: '4',
      status: 'DRAFT',
      sourceSha256: sha256(RAW),
    });
    const stored = repo.versions.get(result.version.id)!;
    expect(stored.nodes).toHaveLength(result.nodeCount);
    expect(stored.links).toHaveLength(result.linkCount);
    expect(stored.sourceDocument).toEqual(JSON.parse(RAW));
    expect(repo.frameworks.get('howdoesthisland')?.name).toBe('HowDoesThisLand');
  });

  it('writes nothing when the same file is imported again', async () => {
    await importVersion(repo, howDoesThisLand, RAW);
    const again = await importVersion(repo, howDoesThisLand, RAW);
    expect(again.outcome).toBe('unchanged');
    expect(repo.calls).toMatchObject({ createDraft: 1, replaceDraft: 0 });
    expect(repo.versions.size).toBe(1);
  });

  it('replaces a draft when a different file has its version number', async () => {
    const first = await importVersion(repo, howDoesThisLand, RAW);
    const second = await importVersion(repo, howDoesThisLand, edited());
    expect(second.outcome).toBe('replaced');
    expect(second.version.sourceSha256).toBe(sha256(edited()));
    const stored = repo.versions.get(first.version.id)!;
    expect(stored.nodes.find((n) => n.kind === 'appeal' && n.key === 'ethos')?.name).toBe('Edited');
  });

  it('refuses a different file under a published version, and changes nothing', async () => {
    const { version } = await importVersion(repo, howDoesThisLand, RAW);
    await publishVersion(repo, 'howdoesthisland', '0.5.1');
    const before = JSON.stringify(repo.versions.get(version.id));

    const err = await refusal(importVersion(repo, howDoesThisLand, edited()));
    expect(err.code).toBe('VERSION_PUBLISHED');
    expect(repo.calls.replaceDraft).toBe(0);
    expect(JSON.stringify(repo.versions.get(version.id))).toBe(before);
  });

  it('refuses when the version stops being a draft between the read and the write', async () => {
    // The repo's own draft condition is the last line: the store reads DRAFT,
    // then someone publishes before the replace runs.
    await importVersion(repo, howDoesThisLand, RAW);
    const realReplace = repo.replaceDraft.bind(repo);
    repo.replaceDraft = async (id, content) => {
      repo.versions.get(id)!.status = 'PUBLISHED';
      return realReplace(id, content);
    };
    const err = await refusal(importVersion(repo, howDoesThisLand, edited()));
    expect(err.code).toBe('VERSION_PUBLISHED');
  });

  it('answers the same file under a published version as unchanged, not as an error', async () => {
    await importVersion(repo, howDoesThisLand, RAW);
    await publishVersion(repo, 'howdoesthisland', '0.5.1');
    const again = await importVersion(repo, howDoesThisLand, RAW);
    expect(again.outcome).toBe('unchanged');
    expect(again.version.status).toBe('PUBLISHED');
  });

  it('refuses 0.5.0 before writing anything, listing all 39 problems', async () => {
    const err = await refusal(importVersion(repo, howDoesThisLand, RAW_0_5_0));
    expect(err.code).toBe('INVALID_MODEL');
    expect(err.problems).toHaveLength(39);
    expect(err.message).toContain('39 problem(s)');
    expect(err.message).toContain('"th_adamson"');
    expect(repo.calls.createDraft).toBe(0);
    expect(repo.versions.size).toBe(0);
  });

  it('refuses a file that is not JSON', async () => {
    const err = await refusal(importVersion(repo, howDoesThisLand, '{ not json'));
    expect(err.code).toBe('INVALID_JSON');
    expect(repo.versions.size).toBe(0);
  });
});

describe('publishVersion()', () => {
  it('publishes a draft, once', async () => {
    await importVersion(repo, howDoesThisLand, RAW);
    const at = new Date('2026-11-12T12:00:00Z');
    const first = await publishVersion(repo, 'howdoesthisland', '0.5.1', at);
    expect(first.outcome).toBe('published');
    expect(first.version).toMatchObject({ status: 'PUBLISHED', publishedAt: at });

    const second = await publishVersion(repo, 'howdoesthisland', '0.5.1');
    expect(second.outcome).toBe('already_published');
    expect(second.version.publishedAt).toEqual(at);
    expect(repo.calls.markPublished).toBe(1);
  });

  it('refuses a version that does not exist', async () => {
    const err = await refusal(publishVersion(repo, 'howdoesthisland', '9.9.9'));
    expect(err.code).toBe('VERSION_NOT_FOUND');
  });

  it('refuses a retired version', async () => {
    const { version } = await importVersion(repo, howDoesThisLand, RAW);
    repo.versions.get(version.id)!.status = 'RETIRED';
    const err = await refusal(publishVersion(repo, 'howdoesthisland', '0.5.1'));
    expect(err.code).toBe('VERSION_NOT_DRAFT');
    expect(repo.calls.markPublished).toBe(0);
  });

  it('refuses when the repo finds the version no longer a draft', async () => {
    await importVersion(repo, howDoesThisLand, RAW);
    repo.markPublished = () => Promise.resolve(false);
    const err = await refusal(publishVersion(repo, 'howdoesthisland', '0.5.1'));
    expect(err.code).toBe('VERSION_NOT_DRAFT');
  });
});

describe('materialise()', () => {
  it('rebuilds the imported file exactly', async () => {
    const { version } = await importVersion(repo, howDoesThisLand, RAW);
    expect(await materialise(repo, howDoesThisLand, version.id)).toStrictEqual(JSON.parse(RAW));
  });

  it('caches a published version, and hands every caller the same frozen model', async () => {
    const { version } = await importVersion(repo, howDoesThisLand, RAW);
    await publishVersion(repo, 'howdoesthisland', '0.5.1');
    const first = await materialise(repo, howDoesThisLand, version.id);
    const second = await materialise(repo, howDoesThisLand, version.id);
    expect(second).toBe(first);
    expect(repo.calls.readNodes).toBe(1);
    expect(Object.isFrozen((first.appeals as JsonObject[])[0])).toBe(true);
  });

  it('does not cache a draft, which a re-import can still change', async () => {
    const { version } = await importVersion(repo, howDoesThisLand, RAW);
    await materialise(repo, howDoesThisLand, version.id);
    await importVersion(repo, howDoesThisLand, edited('Changed again'));
    const model = await materialise(repo, howDoesThisLand, version.id);
    expect((model.appeals as JsonObject[])[0]!.name).toBe('Changed again');
    expect(repo.calls.readNodes).toBe(2);
  });

  it('refuses an unknown version id, and another framework’s version', async () => {
    expect((await refusal(materialise(repo, howDoesThisLand, 'nope'))).code).toBe(
      'VERSION_NOT_FOUND'
    );
    const { version } = await importVersion(repo, howDoesThisLand, RAW);
    const other = { ...howDoesThisLand, slug: 'another' };
    expect((await refusal(materialise(repo, other, version.id))).code).toBe('VERSION_NOT_FOUND');
  });
});
