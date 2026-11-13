/**
 * Tests: tests/fixtures/app/engine-baseline/ — the committed baseline still
 * describes the prototype in the tree (t-12).
 *
 * The fixtures are only a baseline for the engine, model and eval set they were
 * recorded from. If any of those changes and nobody re-runs
 * `npx tsx scripts/app/baseline/record.ts`, the port (e2) would be checked
 * against outputs of an engine that no longer exists, and every other test
 * would still pass. The same goes for the recorder's own files, which decide
 * the corpus, the synthetic judge outputs and the bytes. So this compares the
 * manifest's sha256 values with all of those files as they are now, and holds
 * the fixture directory to exactly the manifest's case list, with every file
 * in canonical form.
 *
 * Reads `prototype/` off disk (allowed; see prototype-guard.test.ts), never
 * imports it. Registered in `appAlwaysRunTests` (`lib/app/ci.ts`): nothing
 * imports the prototype or the fixtures, so no import chain reaches here.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { canonicalJson } from '@/scripts/app/baseline/canonical';

const DIR = 'tests/fixtures/app/engine-baseline';
const RERUN =
  'stale baseline: re-run `npx tsx scripts/app/baseline/record.ts` and commit the result';

const manifestSchema = z.object({
  sources: z.record(z.string(), z.object({ path: z.string(), sha256: z.string() })),
  recorder: z.record(z.string(), z.string()),
  cases: z.array(z.string()).min(1),
});
const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))
);

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

describe('the engine baseline', () => {
  it('was recorded from the engine, model and eval set now in prototype/', () => {
    expect(Object.keys(manifest.sources).sort()).toEqual(['engine', 'evalSet', 'model']);
    for (const { path: file, sha256 } of Object.values(manifest.sources)) {
      expect(sha(file), `${file}: ${RERUN}`).toBe(sha256);
    }
  });

  it('was recorded by the recorder now in scripts/app/baseline/', () => {
    const files = readdirSync('scripts/app/baseline').map((f) => `scripts/app/baseline/${f}`);
    expect(Object.keys(manifest.recorder).sort()).toEqual(files.sort());
    for (const [file, sha256] of Object.entries(manifest.recorder)) {
      expect(sha(file), `${file}: ${RERUN}`).toBe(sha256);
    }
  });

  it('holds exactly the manifest and the case files it lists', () => {
    const onDisk = readdirSync(DIR, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.relative(DIR, path.join(e.parentPath, e.name)).split(path.sep).join('/'));
    expect(onDisk.sort()).toEqual([...manifest.cases, 'manifest.json'].sort());
  });

  it('keeps every file in canonical form', () => {
    for (const rel of [...manifest.cases, 'manifest.json']) {
      const text = readFileSync(path.join(DIR, rel), 'utf8');
      expect(canonicalJson(JSON.parse(text)), `${rel} is not canonical JSON`).toBe(text);
    }
  });
});
