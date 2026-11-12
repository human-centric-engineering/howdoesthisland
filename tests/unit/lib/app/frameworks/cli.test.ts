/**
 * The import and publish commands (t-10): usage, output, exit codes, and that
 * both run in the system scope.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { runImport, runPublish, type CliDeps } from '@/lib/app/frameworks/cli';
import { FakeFrameworkRepo } from '@/tests/unit/lib/app/frameworks/fake-repo';

const FILE = 'lib/app/frameworks/howdoesthisland/data/model-0.5.1.json';
const OLD = 'tests/unit/lib/app/frameworks/fixtures/model-0.5.0.json';

let repo: FakeFrameworkRepo;
let lines: string[];
let deps: CliDeps;
const reasons: string[] = [];

beforeEach(() => {
  repo = new FakeFrameworkRepo();
  lines = [];
  reasons.length = 0;
  deps = {
    repo,
    readFile: (path) => readFileSync(path, 'utf8'),
    runAsSystem: (reason, fn) => {
      reasons.push(reason);
      return fn();
    },
    out: (line) => lines.push(line),
  };
});

describe('runImport()', () => {
  it('imports a model as a draft, in the system scope, and says what it did', async () => {
    expect(await runImport(['howdoesthisland', FILE], deps)).toBe(0);
    expect(reasons).toEqual(['framework import: howdoesthisland']);
    expect(lines).toEqual([
      expect.stringMatching(
        /^howdoesthisland 0\.5\.1: created \(draft, \d+ records, \d+ links, sha256 [0-9a-f]{64}\)$/
      ),
    ]);
    expect(repo.versions.size).toBe(1);
  });

  it('exits 1 and prints every problem when the model is refused', async () => {
    expect(await runImport(['howdoesthisland', OLD], deps)).toBe(1);
    expect(lines[0]).toContain('39 problem(s)');
    expect(lines[0]).toContain('st_choice_overload');
    expect(repo.versions.size).toBe(0);
  });

  it('exits 2 on bad usage or an unknown framework, without reading the file', async () => {
    const readFile = vi.fn();
    deps.readFile = readFile;
    expect(await runImport([], deps)).toBe(2);
    expect(await runImport(['howdoesthisland', FILE, 'extra'], deps)).toBe(2);
    expect(await runImport(['nope', FILE], deps)).toBe(2);
    expect(lines).toEqual([
      'Usage: import.ts <framework-slug> <model-file.json>',
      'Usage: import.ts <framework-slug> <model-file.json>',
      'Unknown framework "nope".',
    ]);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('lets an unexpected failure through rather than reporting it as a refusal', async () => {
    repo.findVersion = () => Promise.reject(new Error('database down'));
    await expect(runImport(['howdoesthisland', FILE], deps)).rejects.toThrow('database down');
  });
});

describe('runPublish()', () => {
  it('publishes a draft in the system scope, then reports a second publish as a no-op', async () => {
    await runImport(['howdoesthisland', FILE], deps);
    lines.length = 0;
    expect(await runPublish(['howdoesthisland', '0.5.1'], deps)).toBe(0);
    expect(await runPublish(['howdoesthisland', '0.5.1'], deps)).toBe(0);
    expect(lines).toEqual([
      'howdoesthisland 0.5.1: published',
      'howdoesthisland 0.5.1: already published',
    ]);
    expect(reasons).toContain('framework publish: howdoesthisland 0.5.1');
  });

  it('exits 1 for a version that does not exist', async () => {
    expect(await runPublish(['howdoesthisland', '9.9.9'], deps)).toBe(1);
    expect(lines).toEqual(['No howdoesthisland version 9.9.9 to publish.']);
  });

  it('exits 2 on bad usage', async () => {
    expect(await runPublish(['howdoesthisland'], deps)).toBe(2);
    expect(lines).toEqual(['Usage: publish.ts <framework-slug> <version>']);
  });
});
