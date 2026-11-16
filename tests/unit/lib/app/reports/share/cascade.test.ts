/**
 * Tests: a share link goes with its assessment (t-32).
 *
 * Deleting an assessment (`DELETE /api/v1/assessments/{id}`) and the
 * retention purge (t-26) both delete the assessment row and rely on the
 * database to take what hangs off it. So a share link must cascade from its
 * assessment, in the schema and in the migration that created the table. A
 * `Restrict` here would make either delete fail; a `SetNull` is impossible
 * (the column is required) and would leave a link with nothing to open.
 *
 * The database is not reachable from unit tests, so this reads the two
 * files. The cascade itself was checked against the dev database (PR).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function modelBlock(schema: string, model: string): string {
  const start = schema.indexOf(`model ${model} {`);
  expect(start, `model ${model} in app.prisma`).toBeGreaterThanOrEqual(0);
  return schema.slice(start, schema.indexOf('\n}', start));
}

describe('ReportShare → Assessment', () => {
  it('cascades in the schema', () => {
    const schema = readFileSync(join(ROOT, 'prisma/schema/app.prisma'), 'utf8');
    const relation = modelBlock(schema, 'ReportShare')
      .split('\n')
      .find((line) => /^\s*assessment\s+Assessment\s/.test(line));
    expect(relation).toMatch(
      /@relation\(fields: \[assessmentId\], references: \[id\], onDelete: Cascade\)/
    );
  });

  it('cascades in the migration that made the table', () => {
    const dir = join(ROOT, 'prisma/migrations');
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith('_app_report_share'))
      .map((name) => readFileSync(join(dir, name, 'migration.sql'), 'utf8'))
      .join('\n');
    expect(sql).toMatch(
      /ALTER TABLE "app_report_share" ADD CONSTRAINT "app_report_share_assessmentId_fkey" FOREIGN KEY \("assessmentId"\) REFERENCES "app_assessment"\("id"\) ON DELETE CASCADE/
    );
  });
});
