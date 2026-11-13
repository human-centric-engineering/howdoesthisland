/**
 * Assembling an assessment (t-13): the prototype's `assemble`, with
 * `libraryRecs` and `dedupeFlags`, ported line for line.
 *
 * `assemble` merges the quick scan with whatever judge outputs arrived. A
 * group with a reply takes the judge's scores, highlights, recommendations
 * and flags; a group without one keeps the quick scan's, with the library's
 * recommendations. Ids the model does not have are dropped, and a score is
 * coerced and clamped, exactly as the prototype does. Checking a reply
 * against the model before it gets here is j2's (f-judges).
 *
 * **The culture switch (D11).** With culture off, the culture group is not a
 * group: its judge output is ignored, a culture dimension named by any other
 * judge is dropped as unknown, and the result has no culture scores,
 * dimensions, highlights, recommendations or block (`culture: null`). The
 * effective weights treat the reader as a global audience.
 */
import { lewisLabel, cl01 } from '@/lib/app/frameworks/howdoesthisland/engine/culture';
import {
  APPEALS,
  CULTURE_GROUP,
  must,
  type Appeal,
  type Dimension,
  type EngineModel,
} from '@/lib/app/frameworks/howdoesthisland/engine/model';
import type { EngineOptions } from '@/lib/app/frameworks/howdoesthisland/engine/quick-scan';
import {
  appealOf,
  appealScore,
  appealShare,
  balanceFindings,
  bandOf,
  effectiveWeights,
  fnTarget,
} from '@/lib/app/frameworks/howdoesthisland/engine/scoring';
import { clamp, locate } from '@/lib/app/frameworks/howdoesthisland/engine/text';
import type {
  Assessment,
  CultureReport,
  EngineContext,
  Highlight,
  JudgeOutputs,
  LeverState,
  LeverStatus,
  QuickScan,
  Recommendation,
  RedFlag,
  Source,
} from '@/lib/app/frameworks/howdoesthisland/engine/types';

const LEVER_STATUSES: readonly LeverStatus[] = ['present', 'absent', 'misused', 'not_applicable'];
const isLeverStatus = (s: unknown): s is LeverStatus =>
  typeof s === 'string' && (LEVER_STATUSES as readonly string[]).includes(s);

/** `+x || 0`: a judge's score as a number, 0 when it is not one. */
const num = (x: unknown): number => Number(x) || 0;

/** The extra groups and their dimensions this engine reports: culture only when on. */
function extras(m: EngineModel, opts: EngineOptions) {
  return {
    groups: m.GROUPS.filter((g) => opts.culture || g.id !== CULTURE_GROUP),
    dims: m.EXTRA.filter((d) => opts.culture || d.group !== CULTURE_GROUP),
  };
}

/** The model's own advice for each group's weakest dimensions, used when no judge replied. */
function libraryRecs(
  m: EngineModel,
  scores: Readonly<Record<string, number>>,
  hl: readonly Highlight[],
  ctx: EngineContext,
  opts: EngineOptions
): Recommendation[] {
  const recs: Recommendation[] = [];
  const prio = must(m.CT, ctx.contentType, 'content type').priority_dimensions;
  const groups = new Map<string, Dimension[]>([
    ['ethos', []],
    ['pathos', []],
    ['logos', []],
    ['kairos', []],
    ['lenses', [...m.LENSES]],
  ]);
  for (const d of m.DIMS) groups.get(d.appeal)?.push(d);
  const ex = extras(m, opts);
  for (const g of ex.groups)
    groups.set(
      g.id,
      ex.dims.filter((d) => d.group === g.id)
    );
  for (const [ap, ds] of groups) {
    const rank = (d: Dimension) => scores[d.id] - (prio.includes(d.id) ? 1 : 0);
    const weak = ds
      .filter((d) => scores[d.id] <= 2)
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, ap === 'lenses' ? 2 : 3);
    for (const d of weak) {
      const w = hl.find((h) => h.dimension === d.id && h.polarity === 'weakness');
      const impact = prio.includes(d.id) ? 'high' : scores[d.id] <= 1 ? 'medium' : 'low';
      if (!d.moves || !d.moves.length) {
        if (!d.advice) continue;
        recs.push({
          appeal: ap,
          dimension: d.id,
          move: null,
          issue: `${d.name} scores ${scores[d.id]} of 4. ${d.advice}`,
          original: w ? w.quote : d.example?.before || '',
          rewrite: d.example?.after || '',
          impact,
          source: 'library',
          example: !w,
        });
        continue;
      }
      const mv = must(m.MOVE, d.moves[0], 'move');
      recs.push({
        appeal: ap,
        dimension: d.id,
        move: mv.id,
        issue: `${d.name} scores ${scores[d.id]} of 4. ${mv.how}`,
        original: w ? w.quote : mv.example.before,
        rewrite: mv.example.after,
        impact,
        source: 'library',
        example: !w,
      });
    }
  }
  return recs;
}

/** The first of each flag id and quote, case-insensitively. */
function dedupeFlags(f: readonly RedFlag[]): RedFlag[] {
  const seen = new Set<string>();
  return f.filter((x) => {
    const k = x.id + '|' + (x.quote || '').toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Whether a judge may name this dimension: one the model has, and (with
 * culture off) not a culture one, whichever judge names it.
 */
const knownDimension = (m: EngineModel, opts: EngineOptions, id: string): boolean => {
  const d = m.DIM.get(id);
  return d !== undefined && (opts.culture || d.group !== CULTURE_GROUP);
};

/** Combines the quick scan with whatever AI judge outputs have arrived. */
export function assemble(
  m: EngineModel,
  text: string,
  ctx: EngineContext,
  q: QuickScan,
  ai: JudgeOutputs,
  source: string | null,
  opts: EngineOptions
): Assessment {
  const ex = extras(m, opts);
  const sc: Record<string, number> = { ...q.scores };
  const why: Record<string, string | undefined> = { ...q.notes };
  const src: Record<string, Source> = Object.fromEntries(Object.keys(sc).map((k) => [k, 'quick']));
  const hl: Highlight[] = [];
  const recs: Recommendation[] = [];
  const flags: RedFlag[] = [...q.flags];
  const summaries: Record<string, string> = {};
  const lib = libraryRecs(m, sc, q.highlights, ctx, opts);
  const known = (id: string) => knownDimension(m, opts, id);
  for (const g of ['ethos', 'pathos', 'logos', 'kairos', 'lenses', ...ex.groups.map((x) => x.id)]) {
    const out = ai[g];
    if (out) {
      summaries[g] = out.summary || '';
      for (const d of out.dimension_scores ?? []) {
        if (known(d.id)) {
          sc[d.id] = clamp(num(d.score));
          why[d.id] = d.rationale;
          src[d.id] = 'ai';
        }
      }
      for (const h of out.highlights ?? []) {
        const at = locate(text, h.quote);
        if (at && known(h.dimension)) {
          hl.push({
            start: at[0],
            end: at[1],
            quote: h.quote,
            dimension: h.dimension,
            appeal: appealOf(m, h.dimension),
            polarity: h.polarity === 'weakness' ? 'weakness' : 'strength',
            note: h.note || '',
            source: 'ai',
          });
        }
      }
      for (const r of out.recommendations ?? []) {
        if (known(r.dimension)) {
          recs.push({
            appeal: g,
            dimension: r.dimension,
            move: r.move && m.MOVE.has(r.move) ? r.move : null,
            issue: r.issue,
            original: r.original || '',
            rewrite: r.rewrite,
            impact: r.impact || 'medium',
            source: 'ai',
          });
        }
      }
      for (const f of out.red_flags ?? []) {
        const def = m.FLAG.get(f.id);
        if (def) {
          const at = locate(text, f.quote);
          flags.push({
            id: f.id,
            quote: f.quote,
            start: at?.[0],
            end: at?.[1],
            severity: def.severity,
            note: f.note,
            source: 'ai',
          });
        }
      }
    } else {
      hl.push(...q.highlights.filter((h) => (h.appeal || 'lenses') === g && !h.flag));
      recs.push(...lib.filter((r) => r.appeal === g));
    }
  }
  hl.push(...q.highlights.filter((h) => h.flag));

  let fns = q.fns;
  let fnSource: Source = 'quick';
  const sf = ai.lenses?.duties;
  if (sf) {
    const t = m.FN.reduce((a, f) => a + num(sf[f.id]), 0);
    if (t > 0) {
      fns = Object.fromEntries(m.FN.map((f) => [f.id, Math.round((100 * num(sf[f.id])) / t)]));
      fnSource = 'ai';
    }
  }

  let levers = q.levers;
  let pvScores = q.pvScores;
  const pvSummaries: Record<string, string> = {};
  let pvSource: Source = 'quick';
  const influence = ai.influence;
  if (influence && Array.isArray(influence.perspectives)) {
    levers = { ...q.levers };
    pvScores = { ...q.pvScores };
    pvSource = 'ai';
    for (const p of influence.perspectives) {
      if (!m.PV.has(p.id)) continue;
      pvScores[p.id] = clamp(num(p.score));
      pvSummaries[p.id] = p.summary || '';
      for (const l of p.levers ?? []) {
        if (m.LEVER.has(l.id)) {
          levers[l.id] = {
            status: isLeverStatus(l.status) ? l.status : 'absent',
            quote: l.quote || '',
            note: l.note || '',
          };
        }
      }
    }
    for (const r of influence.recommendations ?? []) {
      if (known(r.dimension)) {
        recs.push({
          appeal: 'influence',
          dimension: r.dimension,
          move: r.move && m.MOVE.has(r.move) ? r.move : null,
          issue: r.issue,
          original: r.original || '',
          rewrite: r.rewrite,
          impact: r.impact || 'medium',
          source: 'ai',
        });
      }
    }
  }

  const groupScores: Record<string, number> = {};
  for (const g of ex.groups) {
    const ds = ex.dims.filter((d) => d.group === g.id);
    groupScores[g.id] = Math.round(
      (100 * ds.reduce((t, d) => t + (sc[d.id] ?? 0), 0)) / (4 * ds.length)
    );
  }

  let culture: CultureReport | null = null;
  const cq = q.culture;
  if (opts.culture && cq) {
    const aiPos = ai.culture?.text_positions;
    const positions = { ...cq.positions };
    if (aiPos) {
      for (const k of m.SCALE_IDS) {
        const v = aiPos[k];
        if (typeof v === 'number') positions[k] = cl01(v);
      }
    }
    const { reader, writer } = cq;
    const gaps =
      writer && !writer.global && !reader.global && writer.id !== reader.id
        ? m.SCALE_IDS.map((k) => ({
            scale: k,
            writer: writer.targets[k],
            reader: reader.targets[k],
            diff: reader.targets[k] - writer.targets[k],
          }))
            .filter((x) => Math.abs(x.diff) >= 0.2)
            .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
        : [];
    culture = {
      reader: {
        id: reader.id,
        name: reader.name,
        global: reader.global,
        lewis: reader.lewis,
        lewis_label: lewisLabel(reader.lewis),
        hofstede: reader.hofstede,
        targets: reader.targets,
        tolerance: reader.tolerance,
      },
      writer: writer
        ? { id: writer.id, name: writer.name, lewis: writer.lewis, targets: writer.targets }
        : null,
      positions,
      gaps,
      source: aiPos ? 'ai' : 'quick',
    };
  }

  const s: Record<Appeal, number> = {
    ethos: appealScore(m, 'ethos', sc, ctx),
    pathos: appealScore(m, 'pathos', sc, ctx),
    logos: appealScore(m, 'logos', sc, ctx),
    kairos: appealScore(m, 'kairos', sc, ctx),
  };
  const w = effectiveWeights(m, ctx, opts);
  const overall = Math.round(APPEALS.reduce((t, a) => t + s[a] * w[a], 0));
  const tot = APPEALS.reduce((t, a) => t + s[a], 0) || 1;
  const balance = Math.round(
    100 - 100 * 0.5 * APPEALS.reduce((t, a) => t + Math.abs(s[a] / tot - w[a]), 0)
  );
  const target = fnTarget(m, ctx);
  const fit = target
    ? Math.round(
        100 - (50 * m.FN.reduce((t, f) => t + Math.abs(fns[f.id] - target[f.id]), 0)) / 100
      )
    : null;
  const primary = m.FN.reduce((b, f) => (fns[f.id] > fns[b] ? f.id : b), m.FN[0].id);
  hl.sort((a, b) => a.start - b.start);

  return {
    model_version: m.data.meta.version,
    // The prototype counted keys; a key with no reply, or a culture reply with
    // culture off, contributes nothing and does not make a result 'full'.
    mode: Object.entries(ai).some(
      ([g, out]) => out !== undefined && (opts.culture || g !== CULTURE_GROUP)
    )
      ? 'full'
      : 'quick',
    content_type: ctx.contentType,
    audience: { archetype: ctx.archetype, role: ctx.role || null, ...ctx.audience },
    effective_weights: w,
    scores: { overall, band: bandOf(m, overall), balance_index: balance, ...s },
    lenses: Object.fromEntries(m.LENSES.map((l) => [l.id, sc[l.id] * 25])),
    duties: { profile: fns, primary, target, fit, source: fnSource },
    appeal_share: appealShare(q.sentences, hl),
    craft: q.craft,
    group_scores: groupScores,
    culture,
    dimensions: [...m.DIMS, ...m.LENSES, ...ex.dims].map((d) => ({
      id: d.id,
      appeal: appealOf(m, d.id),
      score: sc[d.id],
      rationale: why[d.id],
      source: src[d.id],
    })),
    perspectives: m.data.perspectives.map((p) => ({
      id: p.id,
      score: pvScores[p.id],
      summary: pvSummaries[p.id] || '',
      levers: p.levers.map((l): { id: string } & LeverState => ({ id: l.id, ...levers[l.id] })),
    })),
    perspectives_source: pvSource,
    highlights: hl,
    recommendations: recs,
    balance_findings: balanceFindings(m, s, sc),
    red_flags: dedupeFlags(flags),
    judges: summaries,
    source,
  };
}
