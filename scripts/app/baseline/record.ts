/**
 * Record the prototype engine's baseline (t-12).
 *
 *   npx tsx scripts/app/baseline/record.ts
 *
 * Writes `tests/fixtures/app/engine-baseline/`: one canonical-JSON file per
 * case holding the case's input, `quickScan()`'s result, and `assemble()`'s
 * result twice — with no judge outputs (the quick-scan path the free scan and
 * the judge-failure fallback use), and with the synthetic judge outputs in
 * `synthetic.ts` (the merge path). `manifest.json` records the sha256 of the
 * engine, the model and the eval set the run read, and the case list.
 *
 * **Why it runs from a copy.** `prototype/` stays as delivered and no app code
 * imports it (`tests/unit/lib/app/prototype-guard.test.ts`). So this copies
 * `engine.js` and the two JSON files into a fresh temporary directory, imports
 * the engine from there with a dynamic import, and deletes the copy.
 *
 * Deterministic: the engine has no `Math.random` and no `Date`, and nothing
 * here adds either. Running it twice gives identical bytes — that is the check
 * that the fixtures are a baseline rather than a sample. The fixture directory
 * is emptied first, so a case that is no longer recorded does not linger.
 *
 * Exit 0 written, 1 the corpus failed its coverage check or the engine did not
 * load.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { canonicalJson } from '@/scripts/app/baseline/canonical';
import { buildCorpus, checkCoverage, corpusInputs } from '@/scripts/app/baseline/corpus';
import { syntheticJudgeOutputs, syntheticModelSchema } from '@/scripts/app/baseline/synthetic';

const ROOT = process.cwd();
const SOURCES = {
  engine: 'prototype/src/engine.js',
  model: 'prototype/howdoesthisland_model.json',
  evalSet: 'prototype/howdoesthisland_eval_set.json',
} as const;
const OUT = 'tests/fixtures/app/engine-baseline';

const versionSchema = z.object({ meta: z.object({ version: z.string() }) });

const evalSetSchema = z.object({
  meta: z.object({ version: z.string() }),
  cases: z.array(z.object({ id: z.string(), text: z.string() }).passthrough()),
});

type Fn = (...args: unknown[]) => unknown;
const isFn = (v: unknown): v is Fn => typeof v === 'function';
const prop = (o: object, key: string): unknown => Reflect.get(o, key);

interface Engine {
  quickScan: Fn;
  assemble: Fn;
  caseCtx: Fn;
}

/** The module's surface, checked rather than cast: it is code we did not write. */
function loadEngine(mod: unknown, model: unknown): { engine: Engine; split: Fn } {
  if (mod === null || typeof mod !== 'object')
    throw new Error('engine.js did not load as a module');
  const createEngine = prop(mod, 'createEngine');
  const splitSentences = prop(mod, 'splitSentences');
  if (!isFn(createEngine) || !isFn(splitSentences)) {
    throw new Error('engine.js no longer exports createEngine and splitSentences');
  }
  const e: unknown = createEngine(model);
  if (e === null || typeof e !== 'object') throw new Error('createEngine returned nothing');
  const quickScan = prop(e, 'quickScan');
  const assemble = prop(e, 'assemble');
  const caseCtx = prop(e, 'caseCtx');
  if (!isFn(quickScan) || !isFn(assemble) || !isFn(caseCtx)) {
    throw new Error('the engine no longer has quickScan, assemble and caseCtx');
  }
  return { engine: { quickScan, assemble, caseCtx }, split: splitSentences };
}

function sentenceTexts(split: Fn, text: string): string[] {
  return z
    .array(z.object({ text: z.string() }))
    .parse(split(text))
    .map((s) => s.text);
}

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

async function main(): Promise<number> {
  const tmp = mkdtempSync(path.join(tmpdir(), 'hdtl-engine-baseline-'));
  try {
    const copy = {
      engine: path.join(tmp, 'engine.mjs'),
      model: path.join(tmp, 'model.json'),
      evalSet: path.join(tmp, 'eval-set.json'),
    };
    for (const k of ['engine', 'model', 'evalSet'] as const) {
      copyFileSync(path.join(ROOT, SOURCES[k]), copy[k]);
    }

    const modelRaw: unknown = JSON.parse(readFileSync(copy.model, 'utf8'));
    const modelVersion = versionSchema.parse(modelRaw).meta.version;
    const synthModel = syntheticModelSchema.parse(modelRaw);
    const evalSet = evalSetSchema.parse(JSON.parse(readFileSync(copy.evalSet, 'utf8')));

    const mod: unknown = await import(pathToFileURL(copy.engine).href);
    const { engine, split } = loadEngine(mod, modelRaw);

    const { lists: corpusLists, lewis } = corpusInputs(modelRaw);
    const corpus = buildCorpus(corpusLists);
    const gaps = checkCoverage(corpus, corpusLists, lewis);
    if (gaps.length) {
      console.error(`The corpus does not cover what the baseline needs:\n- ${gaps.join('\n- ')}`);
      return 1;
    }

    const cases: { id: string; source: 'eval' | 'corpus'; text: string; ctx: unknown }[] = [
      ...evalSet.cases.map((c) => ({
        id: c.id,
        source: 'eval' as const,
        text: c.text,
        ctx: engine.caseCtx(c),
      })),
      ...corpus.map((p) => ({ id: p.id, source: 'corpus' as const, text: p.text, ctx: p.ctx })),
    ];

    rmSync(path.join(ROOT, OUT), { recursive: true, force: true });
    for (const dir of ['eval', 'corpus']) mkdirSync(path.join(ROOT, OUT, dir), { recursive: true });

    for (const c of cases) {
      const q = engine.quickScan(c.text, c.ctx);
      const judgeOutputs = syntheticJudgeOutputs(synthModel, sentenceTexts(split, c.text), c.id);
      // Each assemble gets its own copy of the scan, so neither can see what
      // the other might have done to it.
      const quick = engine.assemble(c.text, c.ctx, structuredClone(q));
      const full = engine.assemble(
        c.text,
        c.ctx,
        structuredClone(q),
        structuredClone(judgeOutputs)
      );
      writeFileSync(
        path.join(ROOT, OUT, c.source, `${c.id}.json`),
        canonicalJson({
          id: c.id,
          source: c.source,
          input: { text: c.text, ctx: c.ctx },
          quickScan: q,
          judgeOutputs,
          assemble: { quick, full },
        })
      );
    }

    writeFileSync(
      path.join(ROOT, OUT, 'manifest.json'),
      canonicalJson({
        about:
          'The prototype engine’s outputs, recorded by scripts/app/baseline/record.ts (t-12). ' +
          'Regenerate with `npx tsx scripts/app/baseline/record.ts`; the bytes must not change ' +
          'unless the engine, the model or the corpus did.',
        sources: Object.fromEntries(
          (['engine', 'model', 'evalSet'] as const).map((k) => [
            k,
            { path: SOURCES[k], sha256: sha256(readFileSync(copy[k])) },
          ])
        ),
        modelVersion,
        evalSetVersion: evalSet.meta.version,
        cases: cases.map((c) => `${c.source}/${c.id}.json`),
      })
    );

    console.log(`Wrote ${cases.length} cases and manifest.json to ${OUT}/`);
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
