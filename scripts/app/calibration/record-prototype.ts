/**
 * Record the prototype's `calibrate()` totals on its 0.4.0 set (t-37).
 *
 *   npx tsx scripts/app/calibration/record-prototype.ts
 *
 * Writes `tests/fixtures/app/calibration/prototype-0.4.0.json`: the totals the
 * prototype's quick-scan calibration gives, and the sha256 of the three files
 * it read. `tests/unit/lib/app/calibration/parity.test.ts` runs the app's
 * runner over the same cases and holds it to these totals, and fails when a
 * source has changed since they were recorded.
 *
 * Runs from a copy, as the engine baseline does (`scripts/app/baseline/record.ts`):
 * no app code imports `prototype/` (`prototype-guard.test.ts`). Deterministic.
 *
 * Exit 0 written, 1 the engine did not load as expected.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const ROOT = process.cwd();
const PROTOTYPE_SOURCES = {
  engine: 'prototype/src/engine.js',
  model: 'prototype/howdoesthisland_model.json',
  evalSet: 'prototype/howdoesthisland_eval_set.json',
} as const;
const OUT = 'tests/fixtures/app/calibration/prototype-0.4.0.json';

const totalsSchema = z.strictObject({
  appealHits: z.number(),
  appealNear: z.number(),
  appealN: z.number(),
  flagHits: z.number(),
  flagN: z.number(),
  fnHits: z.number(),
  fnN: z.number(),
});

type Fn = (...args: unknown[]) => unknown;
const isFn = (v: unknown): v is Fn => typeof v === 'function';

const sha256 = (file: string) =>
  createHash('sha256')
    .update(readFileSync(path.join(ROOT, file)))
    .digest('hex');

async function main(): Promise<number> {
  const tmp = mkdtempSync(path.join(tmpdir(), 'hdtl-calibration-'));
  try {
    const engineCopy = path.join(tmp, 'engine.mjs');
    copyFileSync(path.join(ROOT, PROTOTYPE_SOURCES.engine), engineCopy);
    const model: unknown = JSON.parse(readFileSync(PROTOTYPE_SOURCES.model, 'utf8'));
    const evalSet: unknown = JSON.parse(readFileSync(PROTOTYPE_SOURCES.evalSet, 'utf8'));

    const mod: unknown = await import(pathToFileURL(engineCopy).href);
    const createEngine: unknown =
      mod !== null && typeof mod === 'object' ? Reflect.get(mod, 'createEngine') : undefined;
    if (!isFn(createEngine)) {
      console.error('engine.js no longer exports createEngine');
      return 1;
    }
    const engine: unknown = createEngine(model);
    const calibrate: unknown =
      engine !== null && typeof engine === 'object' ? Reflect.get(engine, 'calibrate') : undefined;
    if (!isFn(calibrate)) {
      console.error('the engine no longer has calibrate');
      return 1;
    }
    const { totals } = z.object({ totals: totalsSchema }).parse(calibrate(evalSet));

    const sources = Object.fromEntries(
      Object.entries(PROTOTYPE_SOURCES).map(([k, file]) => [k, { file, sha256: sha256(file) }])
    );
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify({ sources, totals }, null, 2)}\n`);
    console.log(`Wrote ${OUT}: ${JSON.stringify(totals)}`);
    return 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  }
);
