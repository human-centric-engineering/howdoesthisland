/**
 * Whole-tree guard: nothing outside `prototype/` imports from it (t-12).
 *
 * `prototype/` is the original artefact, kept verbatim as the reference the
 * app is ported from (prototype/BRIEF.md). The app's engine is a port of
 * `prototype/src/engine.js` (f-engine), and the baseline that checks the port
 * is recorded from a *copy* of it (`scripts/app/baseline/record.ts`). An import
 * reaching into `prototype/` would make the reference part of the build: the
 * port could quietly call the original instead of replacing it, and the
 * baseline would be comparing the engine with itself.
 *
 * What counts: any import specifier — static `import`/`export … from`, a bare
 * `import '…'`, dynamic `import('…')`, `require('…')`, and `vi.mock('…')` /
 * `vi.importActual('…')` — that resolves into `prototype/`, whether written
 * relative (`../../prototype/src/engine`), through the `@/` alias, or as a
 * bare `prototype/…` path. Reading a prototype file off disk is not an import
 * and is allowed: `data-files.test.ts` compares the model to its copy that way,
 * and the recorder copies the engine that way.
 *
 * Registered in `appAlwaysRunTests` (`lib/app/ci.ts`): a new import in a
 * far-off file is exactly the change whose import graph never reaches here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SELF = 'tests/unit/lib/app/prototype-guard.test.ts';

/** Directories that are not source the app owns, or are not source at all. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'prototype',
  'coverage',
  '.turbo',
  '.vercel',
  'playwright-report',
  'test-results',
  '.claude',
  'tmp',
]);
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

/** Every module specifier in `source`, in order of appearance. */
function importSpecifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    // import x from '…' · import { a } from '…' · export * from '…' · import type …
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    // import '…'
    /\bimport\s*['"]([^'"]+)['"]/g,
    // import('…') · require('…') · vi.mock('…') · vi.importActual('…')
    /\b(?:import|require|vi\.mock|vi\.doMock|vi\.importActual)\s*\(\s*['"`]([^'"`]+)['"`]/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) found.push(m[1]);
  return found;
}

/** Whether `specifier`, written in the repo-relative file `from`, lands in `prototype/`. */
function reachesPrototype(specifier: string, from: string): boolean {
  let target: string;
  if (specifier.startsWith('.')) target = path.posix.join(path.posix.dirname(from), specifier);
  else if (specifier.startsWith('@/')) target = specifier.slice(2);
  else target = specifier;
  target = path.posix.normalize(target);
  return target === 'prototype' || target.startsWith('prototype/');
}

function listSourceFiles(dir = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...listSourceFiles(rel));
    } else if (SOURCE.test(entry.name) && rel !== SELF) {
      out.push(rel);
    }
  }
  return out;
}

describe('the specifier matcher', () => {
  it.each([
    ["import { createEngine } from '../../prototype/src/engine.js';", 'lib/app/x.ts'],
    ["import * as E from '@/prototype/src/engine';", 'lib/app/engine/index.ts'],
    ["export { craft } from '../prototype/src/engine';", 'scripts/re-export.ts'],
    ["import type { X } from 'prototype/src/engine';", 'types/x.d.ts'],
    ["import '../../prototype/src/input.css';", 'app/(public)/page.tsx'],
    ["const m = await import('../../prototype/src/engine.js');", 'scripts/app/x.ts'],
    ["const m = require('../prototype/howdoesthisland_model.json');", 'lib/x.cjs'],
    ["vi.mock('@/prototype/src/engine', () => ({}));", 'tests/unit/x.test.ts'],
    ['import {\n  createEngine,\n  craft,\n} from "../../prototype/src/engine";', 'lib/app/x.ts'],
  ])('catches %j', (source, from) => {
    expect(importSpecifiers(source).some((s) => reachesPrototype(s, from))).toBe(true);
  });

  it.each([
    // Reading the file is how the recorder and data-files.test.ts are meant to do it.
    ["readFileSync('prototype/howdoesthisland_model.json');", 'tests/unit/x.test.ts'],
    ["import { z } from 'zod';", 'lib/app/x.ts'],
    ["import { x } from '@/lib/app/prototype-notes';", 'lib/app/x.ts'],
    ["import { x } from './prototypes/thing';", 'lib/app/x.ts'],
    // A path that goes into prototype/ and back out again does not reach it.
    ["import { x } from '../prototype/../lib/app/x';", 'scripts/x.ts'],
    ['// see prototype/src/engine.js for the original', 'lib/app/x.ts'],
  ])('lets %j through', (source, from) => {
    expect(importSpecifiers(source).some((s) => reachesPrototype(s, from))).toBe(false);
  });
});

describe('the tree', () => {
  it('has no file outside prototype/ importing from it', () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles()) {
      for (const spec of importSpecifiers(readFileSync(path.join(ROOT, file), 'utf8'))) {
        if (reachesPrototype(spec, file)) offenders.push(`${file} → ${spec}`);
      }
    }
    expect(offenders, 'prototype/ is the reference to port from, not a module to use').toEqual([]);
  });

  it('is actually scanning the tree', () => {
    // A walk that silently found nothing would pass the test above forever.
    const files = listSourceFiles();
    expect(files).toContain('scripts/app/baseline/record.ts');
    expect(files).toContain('lib/app/ci.ts');
    expect(files.length).toBeGreaterThan(1000);
  });
});
