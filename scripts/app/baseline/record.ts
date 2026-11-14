/**
 * Record the prototype engine's baseline (t-12).
 *
 *   npx tsx scripts/app/baseline/record.ts
 *
 * Writes `tests/fixtures/app/engine-baseline/`: one canonical-JSON file per
 * case holding the case's input, `quickScan()`'s result, and `assemble()`'s
 * result twice — with no judge outputs (the quick-scan path the free scan and
 * the judge-failure fallback use), and with the synthetic judge outputs in
 * `synthetic.ts` (the merge path, with a `source`). `prompts.json` holds the
 * prompt `judgePrompt()` builds for every judge slot and case (t-18), as a
 * line table (`prompts.ts`). `manifest.json` records the sha256 of the
 * engine, the model and the eval set the run read, the case list and the
 * prompts file.
 *
 * **Why it runs from a copy.** `prototype/` stays as delivered and no app code
 * imports it (`tests/unit/lib/app/prototype-guard.test.ts`). So this copies
 * `engine.js` and the two JSON files into a fresh temporary directory, imports
 * the engine from there with a dynamic import, and deletes the copy.
 *
 * Deterministic: the engine has no `Math.random` and no `Date`, and nothing
 * here adds either. Running it twice gives identical bytes — that is the check
 * that the fixtures are a baseline rather than a sample. Every case is run and
 * serialised before anything is written, then written in full to a sibling
 * staging directory, and only then swapped in for the old one (so a case no
 * longer recorded does not linger). A run that throws partway, in the engine
 * or on a write, therefore leaves the committed baseline as it was.
 *
 * `manifest.json` also records the sha256 of the recorder's own files
 * ({@link RECORDER}): `fixtures.test.ts` fails when any input to the bytes
 * has changed since they were written.
 *
 * Exit 0 written, 1 the corpus failed its coverage check or the engine did not
 * load.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { canonicalJson } from '@/scripts/app/baseline/canonical';
import { buildCorpus, checkCoverage, corpusInputs } from '@/scripts/app/baseline/corpus';
import { encodePrompts } from '@/scripts/app/baseline/prompts';
import { syntheticJudgeOutputs, syntheticModelSchema } from '@/scripts/app/baseline/synthetic';

const ROOT = process.cwd();
const SOURCES = {
  engine: 'prototype/src/engine.js',
  model: 'prototype/howdoesthisland_model.json',
  evalSet: 'prototype/howdoesthisland_eval_set.json',
} as const;
/**
 * The recorder's own files. They decide the corpus, the synthetic judge
 * outputs, the calls made and the bytes written, so a change to any of them
 * stales the fixtures as surely as a change to the engine does.
 */
const RECORDER = [
  'scripts/app/baseline/canonical.ts',
  'scripts/app/baseline/corpus.ts',
  'scripts/app/baseline/prompts.ts',
  'scripts/app/baseline/record.ts',
  'scripts/app/baseline/synthetic.ts',
] as const;
const OUT = 'tests/fixtures/app/engine-baseline';
/** The judge prompts, beside the cases. */
const PROMPTS = 'prompts.json';
/** Written in full first, then swapped in for {@link OUT}. */
const STAGING = `${OUT}.staging`;

/**
 * The `source` handed to the judged `assemble()`. The prototype app passes
 * where the text came from, and `assemble()` returns it as is, so the merge
 * path is recorded with one rather than with the `null` default.
 */
const sourceFor = (id: string) => `baseline:${id}`;

const versionSchema = z.object({ meta: z.object({ version: z.string() }) });

/** Each judge's slot and the appeal `judgePrompt()` is called with. */
const judgesSchema = z.object({
  judges: z.array(z.object({ id: z.string(), appeal: z.string() })).min(1),
});

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
  judgePrompt: Fn;
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
  const judgePrompt = prop(e, 'judgePrompt');
  if (!isFn(quickScan) || !isFn(assemble) || !isFn(caseCtx) || !isFn(judgePrompt)) {
    throw new Error('the engine no longer has quickScan, assemble, caseCtx and judgePrompt');
  }
  return { engine: { quickScan, assemble, caseCtx, judgePrompt }, split: splitSentences };
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
    const { judges } = judgesSchema.parse(modelRaw);
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

    const files = new Map<string, string>();
    const prompts: [string, [string, string][]][] = [];
    for (const c of cases) {
      prompts.push([
        `${c.source}/${c.id}.json`,
        judges.map((j) => [j.id, z.string().parse(engine.judgePrompt(j.appeal, c.text, c.ctx))]),
      ]);
      const q = engine.quickScan(c.text, c.ctx);
      const judgeOutputs = syntheticJudgeOutputs(synthModel, sentenceTexts(split, c.text), c.id);
      // Each assemble gets its own copy of the scan, so neither can see what
      // the other might have done to it.
      const quick = engine.assemble(c.text, c.ctx, structuredClone(q));
      const full = engine.assemble(
        c.text,
        c.ctx,
        structuredClone(q),
        structuredClone(judgeOutputs),
        sourceFor(c.id)
      );
      files.set(
        `${c.source}/${c.id}.json`,
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

    files.set(
      'manifest.json',
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
        recorder: Object.fromEntries(
          RECORDER.map((file) => [file, sha256(readFileSync(path.join(ROOT, file)))])
        ),
        modelVersion,
        evalSetVersion: evalSet.meta.version,
        cases: cases.map((c) => `${c.source}/${c.id}.json`),
        prompts: PROMPTS,
      })
    );
    files.set(PROMPTS, canonicalJson(encodePrompts(prompts)));

    const staging = path.join(ROOT, STAGING);
    rmSync(staging, { recursive: true, force: true });
    try {
      for (const dir of ['eval', 'corpus']) mkdirSync(path.join(staging, dir), { recursive: true });
      for (const [rel, body] of files) writeFileSync(path.join(staging, rel), body);
    } catch (err) {
      rmSync(staging, { recursive: true, force: true });
      throw err;
    }
    // The old baseline goes only once the new one is complete on disk.
    rmSync(path.join(ROOT, OUT), { recursive: true, force: true });
    renameSync(staging, path.join(ROOT, OUT));

    console.log(`Wrote ${cases.length} cases, ${PROMPTS} and manifest.json to ${OUT}/`);
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
