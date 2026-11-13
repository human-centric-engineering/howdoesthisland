/**
 * The engine as callers reach it (t-13): through the framework definition,
 * on the frozen model `materialise()` serves, and behind the culture switch
 * (D11).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const env = vi.hoisted(() => ({
  NODE_ENV: 'test',
  CULTURE_MODULE_ENABLED: undefined as boolean | undefined,
}));
vi.mock('@/lib/env', () => ({ env }));

import { getFrameworkDefinition } from '@/lib/app/frameworks/registry';
import {
  createHowDoesThisLandEngine,
  type Assessment,
  type EngineContext,
  type HowDoesThisLandEngine,
  type JudgeOutputs,
  type QuickScan,
} from '@/lib/app/frameworks/howdoesthisland/engine';
import { indexModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import {
  HOWDOESTHISLAND_SLUG,
  howDoesThisLand,
} from '@/lib/app/frameworks/howdoesthisland/definition';
import {
  __resetMaterialiseCacheForTests,
  importVersion,
  materialise,
  publishVersion,
} from '@/lib/app/frameworks/store';
import { FakeFrameworkRepo } from '@/tests/unit/lib/app/frameworks/fake-repo';
import {
  MODEL_FILE,
  loadCases,
  loadModel,
} from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

const model = loadModel();
const cases = loadCases();

/** Every output the engine makes for a case, quick and judged. */
function runAll(e: HowDoesThisLandEngine, text: string, ctx: EngineContext, ai: JudgeOutputs) {
  const q = e.quickScan(text, ctx);
  return {
    q,
    quick: e.assemble(text, ctx, structuredClone(q)),
    full: e.assemble(text, ctx, structuredClone(q), ai, 'test'),
  };
}

async function frozenModel() {
  __resetMaterialiseCacheForTests();
  const repo = new FakeFrameworkRepo();
  const { version } = await importVersion(repo, howDoesThisLand, readFileSync(MODEL_FILE, 'utf8'));
  await publishVersion(repo, HOWDOESTHISLAND_SLUG, version.version);
  return materialise(repo, howDoesThisLand, version.id);
}

beforeEach(() => {
  env.CULTURE_MODULE_ENABLED = undefined;
});

describe('reaching the engine', () => {
  it('goes from the slug to the definition to an engine', () => {
    const def = getFrameworkDefinition(HOWDOESTHISLAND_SLUG);
    expect(def).not.toBeNull();
    const c = cases[0];
    const viaDefinition = def?.createEngine(model).quickScan(c.input.text, c.input.ctx);
    const direct = createHowDoesThisLandEngine(model, { culture: true }).quickScan(
      c.input.text,
      c.input.ctx
    );
    expect(viaDefinition).toEqual(direct);
  });

  it('refuses a model that lacks what the engine reads, naming the field', () => {
    const { duties: _gone, ...noDuties } = model;
    expect(() => createHowDoesThisLandEngine(noDuties, { culture: true })).toThrow(/duties/);
  });

  it('names an unknown content type rather than scoring against nothing', () => {
    const e = createHowDoesThisLandEngine(model, { culture: true });
    const ctx: EngineContext = { contentType: 'zz_nope', archetype: 'general', audience: {} };
    const q = e.quickScan('A short text. Another sentence here.', ctx);
    expect(() => e.assemble('A short text. Another sentence here.', ctx, q)).toThrow(
      "The model has no content type 'zz_nope'"
    );
  });

  it('exposes primaryDuty for f-rewrite', () => {
    const e = createHowDoesThisLandEngine(model, { culture: true });
    expect(e.primaryDuty({ contentType: 'general', archetype: 'auditor', audience: {} })).toBe(
      'teach'
    );
    expect(
      e.primaryDuty({ contentType: 'general', archetype: 'general', audience: {} })
    ).toBeNull();
  });

  it('scores a model without culture or length targets, as the prototype’s defaults do', () => {
    const { culture: _c, length_targets: _l, ...core } = model;
    const e = createHowDoesThisLandEngine(core, { culture: true });
    const c = cases[0];
    const q = e.quickScan(c.input.text, c.input.ctx);
    const r = e.assemble(c.input.text, c.input.ctx, q);
    expect(r.culture?.reader.global).toBe(true);
    expect(r.dimensions.some((d) => d.id.startsWith('cul_') && d.score === undefined)).toBe(true);
    expect(q.notes.craft_length).toContain('typical range for this content type is 80 to 900');
  });

  it('scores craft tone on a model with no culture section and culture off', () => {
    const { culture: _c, ...core } = model;
    const e = createHowDoesThisLandEngine(core, { culture: false });
    const c = cases[0];
    const q = e.quickScan(c.input.text, c.input.ctx);
    expect(Number.isFinite(q.scores.craft_tone)).toBe(true);
    expect(Number.isFinite(e.assemble(c.input.text, c.input.ctx, q).group_scores.craft)).toBe(true);
  });

  it('hands back results a caller may change: no frozen model objects inside', () => {
    const e = createHowDoesThisLandEngine(model, { culture: true });
    const c = cases.find((x) => x.input.ctx.culture?.reader === 'jp');
    if (!c) throw new Error('the baseline no longer has a Japanese reader');
    const r = e.assemble(c.input.text, c.input.ctx, e.quickScan(c.input.text, c.input.ctx));
    expect(r.culture?.reader.global).toBe(false);
    expect(Object.isFrozen(r.culture?.reader.lewis)).toBe(false);
    expect(Object.isFrozen(r.culture?.reader.hofstede)).toBe(false);
  });

  it('indexes a model object once, however many engines are made from it', () => {
    expect(indexModel(model)).toBe(indexModel(model));
  });
});

describe('the frozen materialised model', () => {
  it('is what the engine runs on, giving the same answers as the file', async () => {
    const frozen = await frozenModel();
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(frozen).toEqual(model);

    const onFrozen = howDoesThisLand.createEngine(frozen);
    const onFile = createHowDoesThisLandEngine(model, { culture: true });
    for (const c of cases.slice(0, 12)) {
      const { text, ctx } = c.input;
      const q = onFrozen.quickScan(text, ctx);
      expect(q).toEqual(onFile.quickScan(text, ctx));
      expect(onFrozen.assemble(text, ctx, q, c.judgeOutputs, 'x')).toEqual(
        onFile.assemble(text, ctx, onFile.quickScan(text, ctx), c.judgeOutputs, 'x')
      );
    }
    expect(frozen).toEqual(model);
  });

  it('is never written: the engine’s own copy is frozen too', () => {
    const m = indexModel(model);
    expect(Object.isFrozen(m.data)).toBe(true);
    expect(Object.isFrozen(m.DIMS[0])).toBe(true);
    expect(Object.isFrozen(m.data.culture?.countries[0]?.lewis)).toBe(true);
  });
});

// ─── The culture switch (D11) ───────────────────────────────────────────────

const isCultureId = (id: string) => id.startsWith('cul_');

/** Every culture output in a case's results: empty with the switch off. */
function cultureOutputs(r: { q: QuickScan; quick: Assessment; full: Assessment }): string[] {
  const found: string[] = [];
  if (r.q.culture) found.push('quickScan.culture');
  for (const k of Object.keys(r.q.scores)) if (isCultureId(k)) found.push(`quickScan.scores.${k}`);
  for (const k of Object.keys(r.q.notes)) if (isCultureId(k)) found.push(`quickScan.notes.${k}`);
  for (const h of r.q.highlights)
    if (isCultureId(h.dimension)) found.push(`quickScan.highlight ${h.dimension}`);
  for (const [name, a] of [
    ['quick', r.quick],
    ['full', r.full],
  ] as const) {
    if (a.culture) found.push(`${name}.culture`);
    if ('culture' in a.group_scores) found.push(`${name}.group_scores.culture`);
    if ('culture' in a.judges) found.push(`${name}.judges.culture`);
    for (const d of a.dimensions) if (isCultureId(d.id)) found.push(`${name}.dimension ${d.id}`);
    for (const h of a.highlights)
      if (isCultureId(h.dimension)) found.push(`${name}.highlight ${h.dimension}`);
    for (const x of a.recommendations) {
      if (x.appeal === 'culture' || isCultureId(x.dimension))
        found.push(`${name}.recommendation ${x.dimension}`);
    }
  }
  return found;
}

/** A context whose culture throws when read: proves the engine never reads it. */
function cultureUnreadable(ctx: EngineContext): EngineContext {
  const { culture: _c, ...rest } = ctx;
  return Object.defineProperty({ ...rest }, 'culture', {
    enumerable: true,
    get() {
      throw new Error('the engine read ctx.culture with the culture switch off');
    },
  });
}

/**
 * The synthetic judge outputs, plus culture dimensions named by a judge
 * other than culture's, which the switch must also keep out.
 */
function withStrayCulture(ai: JudgeOutputs, text: string): JudgeOutputs {
  const ethos = ai.ethos ?? {};
  const quote = text.slice(0, 20).trim();
  return {
    ...ai,
    ethos: {
      ...ethos,
      dimension_scores: [...(ethos.dimension_scores ?? []), { id: 'cul_idiom', score: 1 }],
      highlights: [
        ...(ethos.highlights ?? []),
        { quote, dimension: 'cul_idiom', polarity: 'weakness' },
      ],
      recommendations: [
        ...(ethos.recommendations ?? []),
        { dimension: 'cul_formality', issue: 'stray', rewrite: 'stray' },
      ],
    },
  };
}

describe('the culture switch', () => {
  const on = createHowDoesThisLandEngine(model, { culture: true });
  const off = createHowDoesThisLandEngine(model, { culture: false });

  it('with it on, every case has culture outputs (so the off assertions are not vacuous)', () => {
    for (const c of cases) {
      const found = cultureOutputs(
        runAll(on, c.input.text, c.input.ctx, withStrayCulture(c.judgeOutputs, c.input.text))
      );
      expect(found, c.file).toEqual(
        expect.arrayContaining(['quickScan.culture', 'quick.culture', 'full.judges.culture'])
      );
      expect(
        found.some((f) => f.startsWith('full.dimension cul_')),
        c.file
      ).toBe(true);
    }
  });

  it('with it off, no culture input is read and no culture output appears, in any case', () => {
    for (const c of cases) {
      const ctx = cultureUnreadable(c.input.ctx);
      const r = runAll(off, c.input.text, ctx, withStrayCulture(c.judgeOutputs, c.input.text));
      expect(cultureOutputs(r), c.file).toEqual([]);
      expect(r.quick.culture).toBeNull();
      expect(r.q.culture).toBeNull();
    }
  });

  it('with it off, a reader’s culture no longer moves the weights', () => {
    const c = cases.find((x) => x.input.ctx.culture?.reader === 'jp');
    if (!c) throw new Error('the baseline no longer has a Japanese reader');
    const { text, ctx } = c.input;
    const global: EngineContext = { ...ctx, culture: { reader: 'global' } };
    const weights = (e: HowDoesThisLandEngine, x: EngineContext) =>
      e.assemble(text, x, e.quickScan(text, x)).effective_weights;
    expect(weights(on, ctx)).not.toEqual(weights(on, global));
    expect(weights(off, ctx)).toEqual(weights(on, global));
  });

  it('with it off, everything else is as it is with culture on for a global reader', () => {
    const c = cases[0];
    const { text } = c.input;
    const ctx: EngineContext = { ...c.input.ctx, culture: { reader: 'global' } };
    const a = runAll(on, text, ctx, c.judgeOutputs);
    const b = runAll(off, text, ctx, c.judgeOutputs);
    const strip = (x: Assessment) => ({
      ...x,
      culture: null,
      judges: Object.fromEntries(Object.entries(x.judges).filter(([k]) => k !== 'culture')),
      group_scores: Object.fromEntries(
        Object.entries(x.group_scores).filter(([k]) => k !== 'culture')
      ),
      dimensions: x.dimensions.filter((d) => !isCultureId(d.id)),
      highlights: x.highlights.filter((h) => !isCultureId(h.dimension)),
      recommendations: x.recommendations.filter(
        (r) => r.appeal !== 'culture' && !isCultureId(r.dimension)
      ),
    });
    expect(b.full).toEqual(strip(a.full));
    expect(b.quick).toEqual(strip(a.quick));
  });

  it('counts a result as full only when a judge reply was used', () => {
    const c = cases[0];
    const { text, ctx } = c.input;
    const mode = (e: HowDoesThisLandEngine, ai: JudgeOutputs) =>
      e.assemble(text, ctx, e.quickScan(text, ctx), ai).mode;
    const cultureOnly: JudgeOutputs = { culture: c.judgeOutputs.culture };
    expect(mode(off, cultureOnly)).toBe('quick');
    expect(mode(on, cultureOnly)).toBe('full');
    expect(mode(on, { ethos: undefined })).toBe('quick');
    expect(mode(off, c.judgeOutputs)).toBe('full');
  });

  it('is read from the environment when the definition makes an engine', () => {
    const c = cases[0];
    env.CULTURE_MODULE_ENABLED = false;
    const offViaDef = howDoesThisLand.createEngine(model).quickScan(c.input.text, c.input.ctx);
    env.CULTURE_MODULE_ENABLED = true;
    const onViaDef = howDoesThisLand.createEngine(model).quickScan(c.input.text, c.input.ctx);
    expect(offViaDef).toEqual(off.quickScan(c.input.text, c.input.ctx));
    expect(onViaDef).toEqual(on.quickScan(c.input.text, c.input.ctx));
    expect(offViaDef).not.toEqual(onViaDef);
  });
});
