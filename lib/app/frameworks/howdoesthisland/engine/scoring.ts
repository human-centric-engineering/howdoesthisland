/**
 * Weights and scores (t-13): the prototype's `effectiveWeights`, `fnTarget`,
 * `appealScore`, `bandOf`, `balanceFindings`, `appealShare` and the small
 * helpers they lean on, ported line for line, plus {@link primaryDuty}.
 */
import { globalProfile, cultureProfile } from '@/lib/app/frameworks/howdoesthisland/engine/culture';
import {
  APPEALS,
  must,
  type Appeal,
  type AppealWeights,
  type EngineModel,
  type PartialAppealWeights,
} from '@/lib/app/frameworks/howdoesthisland/engine/model';
import type { Sentence } from '@/lib/app/frameworks/howdoesthisland/engine/text';
import type { EngineContext, Highlight } from '@/lib/app/frameworks/howdoesthisland/engine/types';

/** A dimension's appeal: `lenses` for a lens, null for an id the model lacks. */
export function appealOf(m: EngineModel, id: string): string | null {
  const d = m.DIM.get(id);
  return d ? d.appeal || 'lenses' : null;
}

/** Whether the reader is an executive: by content type, or by a named role. */
export const isExec = (ctx: EngineContext): boolean =>
  ['exec_briefing', 'sales_proposal', 'pitch_deck'].includes(ctx.contentType) || !!ctx.role;

/** The Lewis shift per pole, in `APPEALS` order. */
const LEWIS_SHIFT = {
  linear: [-0.02, -0.04, 0.08, 0],
  multi: [0, 0.08, -0.05, -0.02],
  reactive: [0.08, -0.05, 0, -0.05],
} as const;

/**
 * The appeal mix this reader needs: the content type's weights, moved by the
 * audience, the archetype and (with culture on) the reader's culture, floored
 * and normalised to 1.
 */
export function effectiveWeights(
  m: EngineModel,
  ctx: EngineContext,
  opts: { culture: boolean }
): AppealWeights {
  const w: AppealWeights = { ...must(m.CT, ctx.contentType, 'content type').weights };
  const add = (d: PartialAppealWeights | null | undefined) => {
    for (const a of APPEALS) w[a] += (d && d[a]) || 0;
  };
  for (const mod of m.MODS) {
    add(mod.options.find((o) => o.id === ctx.audience[mod.id])?.weight_delta);
  }
  add(m.ARCH.get(ctx.archetype)?.weight_delta);
  const cp = opts.culture ? cultureProfile(m, ctx.culture?.reader) : globalProfile(m);
  if (!cp.global) {
    for (const pole of ['linear', 'multi', 'reactive'] as const) {
      const k = (cp.lewis[pole] - 1 / 3) * 0.6;
      APPEALS.forEach((a, i) => (w[a] += k * LEWIS_SHIFT[pole][i]));
    }
  }
  for (const a of APPEALS) w[a] = Math.max(0.04, w[a]);
  const t = APPEALS.reduce((s, a) => s + w[a], 0);
  for (const a of APPEALS) w[a] = +(w[a] / t).toFixed(3);
  return w;
}

/** The share of emphasis on each duty that the scoring treats as the target. */
const DUTY_WEIGHT = { primary: 40, secondary: 25, other: 12 } as const;

/**
 * The duty mix this reader needs: most on the role's (else the archetype's)
 * primary duty, less on its secondary, a little on each other. Null when
 * neither names a primary (the `general` archetype).
 */
export function fnTarget(m: EngineModel, ctx: EngineContext): Record<string, number> | null {
  const a = m.ARCH.get(ctx.archetype);
  const r = ctx.role ? m.ROLE.get(ctx.role) : null;
  const p = r ? r.primary : a?.primary;
  const s = r ? r.secondary : a?.secondary;
  if (!p) return null;
  return Object.fromEntries(
    m.FN.map((f) => [
      f.id,
      f.id === p ? DUTY_WEIGHT.primary : f.id === s ? DUTY_WEIGHT.secondary : DUTY_WEIGHT.other,
    ])
  );
}

/**
 * The duty a target weights highest, first in the model's order on a tie, or
 * null for no target.
 *
 * **Fixed in the port (BRIEF §5).** The prototype's `rewritePrompt()` found
 * this duty as the one weighted `=== 40`, which holds only while
 * {@link DUTY_WEIGHT} gives the primary exactly 40. Taking the highest weight
 * keeps the guidance if the weights change.
 */
export function primaryDutyOf(
  m: EngineModel,
  target: Readonly<Record<string, number>> | null
): string | null {
  if (!target) return null;
  let best: string | null = null;
  for (const f of m.FN) {
    const v = target[f.id];
    if (typeof v === 'number' && (best === null || v > target[best])) best = f.id;
  }
  return best;
}

/** The duty this reader most needs the text to do, or null when the context names none. */
export const primaryDuty = (m: EngineModel, ctx: EngineContext): string | null =>
  primaryDutyOf(m, fnTarget(m, ctx));

/**
 * An appeal's 0–100 score: its dimensions' weighted mean, priority dimensions
 * for the content type counting half again, then capped by any integrity cap
 * whose dimension scored too low.
 */
export function appealScore(
  m: EngineModel,
  ap: Appeal,
  sc: Readonly<Record<string, number>>,
  ctx: EngineContext
): number {
  const prio = must(m.CT, ctx.contentType, 'content type').priority_dimensions;
  let n = 0;
  let d = 0;
  for (const dim of m.DIMS.filter((x) => x.appeal === ap)) {
    const w = dim.weight * (prio.includes(dim.id) ? 1.5 : 1);
    n += (sc[dim.id] ?? 0) * w;
    d += 4 * w;
  }
  let v = Math.round((100 * n) / d);
  for (const c of m.data.scoring.integrity_caps ?? []) {
    if (c.appeal === ap && (sc[c.dimension] ?? 4) <= c.if_at_most) v = Math.min(v, c.cap);
  }
  return v;
}

export const bandOf = (m: EngineModel, v: number): string =>
  m.data.scoring.bands.find((b) => v >= b.min && v <= b.max)?.label || '';

/** The balance rules the appeal scores and dimension scores trip. */
export function balanceFindings(
  m: EngineModel,
  s: Readonly<AppealWeights>,
  sc: Readonly<Record<string, number>>
): { id: string; name: string; message: string }[] {
  const R = new Map(m.data.balance_rules.map((r) => [r.id, r]));
  const out: string[] = [];
  if (s.pathos - s.logos > 25) out.push('br_hype');
  if (s.logos - s.pathos > 30) out.push('br_dry');
  if (s.ethos < 40 && (s.pathos > 60 || s.logos > 60)) out.push('br_credibility_gap');
  if ((sc.eth_goodwill ?? 4) <= 1) out.push('br_all_about_me');
  if ((sc.kai_call ?? 4) <= 1) out.push('br_no_ask');
  if ((sc.kai_stakes ?? 0) >= 3 && (sc.kai_efficacy ?? 4) <= 1) out.push('br_doom');
  if (s.kairos < 35) out.push('br_timeless');
  return out.flatMap((id) => {
    const r = R.get(id);
    return r ? [{ id: r.id, name: r.name, message: r.message }] : [];
  });
}

/**
 * The share of the text's words each appeal carries: each sentence goes to
 * the appeal with most strength highlights over it, or to `neutral`.
 */
export function appealShare(
  S: readonly Sentence[],
  hl: readonly Highlight[]
): Record<Appeal | 'neutral', number> {
  const words = { ethos: 0, pathos: 0, logos: 0, kairos: 0, neutral: 0 };
  for (const s of S) {
    const c: Record<Appeal, number> = { ethos: 0, pathos: 0, logos: 0, kairos: 0 };
    for (const h of hl) {
      if (h.polarity === 'strength' && isAppeal(h.appeal) && h.start < s.end && h.end > s.start) {
        c[h.appeal]++;
      }
    }
    const best = APPEALS.reduce<Appeal>((b, a) => (c[a] > c[b] ? a : b), 'ethos');
    words[c[best] ? best : 'neutral'] += s.words;
  }
  const t = Object.values(words).reduce((a, b) => a + b, 0) || 1;
  return {
    ethos: Math.round((100 * words.ethos) / t),
    pathos: Math.round((100 * words.pathos) / t),
    logos: Math.round((100 * words.logos) / t),
    kairos: Math.round((100 * words.kairos) / t),
    neutral: Math.round((100 * words.neutral) / t),
  };
}

export const isAppeal = (a: string | null): a is Appeal =>
  a !== null && (APPEALS as readonly string[]).includes(a);
