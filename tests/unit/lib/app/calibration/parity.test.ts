/**
 * Parity with the prototype (t-37): quick mode on the prototype's own 0.4.0
 * cases gives the totals its `calibrate()` gives.
 *
 * The totals were recorded from a copy of the prototype by
 * `scripts/app/calibration/record-prototype.ts`; the 0.4.0 set is read off
 * disk, which `prototype-guard.test.ts` allows (reading is not importing).
 * The prototype's `caseCtx()` filled the audience defaults and no culture;
 * the runner's `caseContext()` plus the engine's `parseContext` must land on
 * the same context for these cases, or the totals part.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { scoreSet } from '@/lib/app/calibration/run';
import { calibrationCaseSchema } from '@/lib/app/calibration/schema';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';

const FIXTURE = 'tests/fixtures/app/calibration/prototype-0.4.0.json';

const fixture = z
  .object({
    sources: z.record(z.string(), z.object({ file: z.string(), sha256: z.string() })),
    totals: z.object({
      appealHits: z.number(),
      appealNear: z.number(),
      appealN: z.number(),
      flagHits: z.number(),
      flagN: z.number(),
      fnHits: z.number(),
      fnN: z.number(),
    }),
  })
  .parse(JSON.parse(readFileSync(FIXTURE, 'utf8')));

const read = (file: string) => readFileSync(file, 'utf8');
const model = z.looseObject({}).parse(JSON.parse(read(fixture.sources.model.file)));
// The 0.4.0 set's meta predates `model` and `bands`; its cases are read as the runner reads any.
const set = z
  .object({ meta: z.object({ version: z.string() }), cases: z.array(calibrationCaseSchema) })
  .parse(JSON.parse(read(fixture.sources.evalSet.file)));

describe('quick mode against the prototype’s calibrate()', () => {
  it('reads the same sources the totals were recorded from', () => {
    for (const { file, sha256 } of Object.values(fixture.sources)) {
      const now = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(now, `${file} changed: re-run scripts/app/calibration/record-prototype.ts`).toBe(
        sha256
      );
    }
    expect(set.meta.version).toBe('0.4.0');
  });

  it('gives the prototype’s totals on the 0.4.0 cases', async () => {
    const { totals } = await scoreSet({
      engine: createHowDoesThisLandEngine(model, { culture: true }),
      cases: set.cases,
      mode: 'quick',
      frameworkVersion: 'howdoesthisland@0.5.1',
      runId: 'parity',
    });
    const { appeal, flag, duty } = totals.byKind;
    expect({
      appealHits: appeal.ok,
      appealNear: appeal.near,
      appealN: appeal.n,
      flagHits: flag.ok,
      flagN: flag.n,
      fnHits: duty.ok,
      fnN: duty.n,
    }).toEqual(fixture.totals);
  });
});
