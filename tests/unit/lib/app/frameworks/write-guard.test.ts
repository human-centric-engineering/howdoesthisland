/**
 * Only lib/app/frameworks/repo.ts writes the framework tables (t-10).
 *
 * A published version never changes because nothing but the repo can write
 * one, and the repo conditions every such write on the draft state. This
 * guard keeps the first half true: it fails when any other source file calls
 * a write on the four models, or names their tables in raw SQL (migrations
 * excepted).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCANNED = ['app', 'lib', 'scripts', 'components', 'prisma/seeds', 'emails'];
const WRITER = 'lib/app/frameworks/repo.ts';

const PRISMA_WRITE =
  /\.(framework|frameworkVersion|frameworkNode|frameworkLink)\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\b/;
const RAW_SQL = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(public"?\."?)?app_framework/i;

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts|js|mjs)$/.test(name) ? [path] : [];
  });
}

function writersIn(files: string[]): Map<string, string[]> {
  const writers = new Map<string, string[]>();
  for (const file of files) {
    const hits = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => PRISMA_WRITE.test(line) || RAW_SQL.test(line));
    if (hits.length > 0)
      writers.set(
        relative(ROOT, file),
        hits.map((l) => l.trim())
      );
  }
  return writers;
}

describe('the framework tables have one writer', () => {
  const writers = writersIn(SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir))));

  it('finds the repo’s own writes, so the scan is looking in the right place', () => {
    expect(writers.get(WRITER)?.length).toBeGreaterThanOrEqual(6);
  });

  it('finds no other file writing them', () => {
    writers.delete(WRITER);
    expect(
      Object.fromEntries(writers),
      'Only lib/app/frameworks/repo.ts may write Framework, FrameworkVersion, ' +
        'FrameworkNode or FrameworkLink: a published version must never change.'
    ).toEqual({});
  });

  it('recognises the write shapes it is guarding against', () => {
    expect(PRISMA_WRITE.test('await prisma.frameworkNode.updateMany({')).toBe(true);
    expect(PRISMA_WRITE.test('tx.frameworkVersion.delete({ where })')).toBe(true);
    expect(PRISMA_WRITE.test('prisma.frameworkNode.findMany({')).toBe(false);
    expect(PRISMA_WRITE.test('prisma.frameworkNode.count({')).toBe(false);
    expect(RAW_SQL.test('UPDATE "app_framework_node" SET')).toBe(true);
    expect(RAW_SQL.test('SELECT * FROM app_framework_node')).toBe(false);
  });
});
