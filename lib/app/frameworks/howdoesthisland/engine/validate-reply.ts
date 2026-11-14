/**
 * Post-validation of a judge's reply (t-18, BRIEF §5, plan §8.3).
 *
 * The prototype's `validJudgeOutput` checked only that the reply had an
 * array. A reply is external data, and a strict schema is a request a
 * provider may not honour, so this reads it item by item against the
 * version:
 *
 * - **unknown ids are dropped**: a dimension, flag, perspective or lever the
 *   version does not have, or a lever under the wrong perspective. An unknown
 *   move only loses the move; the recommendation stays.
 * - **scores are clamped** to their scale (0–4; duties 0–100; culture
 *   positions 0–1). A numeric string is read as its number, as `assemble()`
 *   reads one.
 * - **quotes are located in the text or dropped**. A highlight or red flag
 *   whose quote is not in the text goes with it, because the quote is its
 *   point; a lever or a recommendation loses only the quote.
 * - **lists are held to the judge's limits** (`max_highlights`,
 *   `max_recommendations`), most important first as the prompt asks.
 * - **what the prompt asks for and the reply lacks is recorded as missing**:
 *   a dimension not scored, a perspective or one of its levers not given, a
 *   duty, the primary duty or a culture position. The strict schema cannot
 *   require these (a list of ids is not a set of them), so a reply can leave
 *   them out. Nothing is filled in; an item dropped for another reason is
 *   also missing, since the output does not have it.
 *
 * Every drop, every clamp and every gap is recorded, by path, so a run can
 * say what its judge got wrong. Only a reply that is not an object, or lacks
 * the list its shape is built on, is refused whole.
 */
import type {
  JudgeDrop as FrameworkJudgeDrop,
  JudgeReplyValidation as FrameworkJudgeReplyValidation,
} from '@/lib/app/frameworks/engine';
import {
  IMPACTS,
  LEVER_STATUSES,
  POLARITIES,
  judgeIds,
  type JudgeIds,
} from '@/lib/app/frameworks/howdoesthisland/engine/judge-schemas';
import type { EngineModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import { locate } from '@/lib/app/frameworks/howdoesthisland/engine/text';
import type {
  JudgeDimensionScore,
  JudgeHighlight,
  JudgeLever,
  JudgeOutput,
  JudgePerspective,
  JudgeRecommendation,
  JudgeRedFlag,
} from '@/lib/app/frameworks/howdoesthisland/engine/types';

export type JudgeDropReason =
  /** Not the shape asked for: a missing or mistyped field. The item is dropped. */
  | 'malformed'
  /** An id the version does not have, or one in the wrong place. */
  | 'unknown_id'
  /** An id already given. The first stands. */
  | 'duplicate'
  /** A number outside its scale. It is clamped, not dropped. */
  | 'out_of_range'
  /** A quote not found in the text. */
  | 'unlocated_quote'
  /** Past the judge's limit for the list. */
  | 'over_limit'
  /** Asked for and not in the output. Nothing is dropped; the gap is recorded, the id as detail. */
  | 'missing';

/** A drop, by path (`highlights[2]`, `perspectives[0].levers[3].quote`), with the offending value. */
export type JudgeDrop = FrameworkJudgeDrop<JudgeDropReason>;

export type JudgeReplyValidation = FrameworkJudgeReplyValidation<JudgeOutput, JudgeDropReason>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A number, or a string that is one; null for anything else. */
function numberOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const show = (v: unknown): string => (typeof v === 'string' ? v : (JSON.stringify(v) ?? String(v)));

class Reader {
  readonly drops: JudgeDrop[] = [];
  constructor(
    readonly text: string,
    readonly ids: JudgeIds
  ) {}

  drop(at: string, reason: JudgeDropReason, value?: unknown): void {
    this.drops.push(value === undefined ? { at, reason } : { at, reason, detail: show(value) });
  }

  /** The list at `key`, or none (recorded when the field is there but is not a list). */
  list(raw: Record<string, unknown>, key: string): unknown[] {
    const v = raw[key];
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) return v;
    this.drop(key, 'malformed', v);
    return [];
  }

  /** A score on its scale, clamped; null (recorded) when it is not a number. */
  score(v: unknown, at: string, lo: number, hi: number): number | null {
    const n = numberOf(v);
    if (n === null) {
      this.drop(at, 'malformed', v);
      return null;
    }
    const clamped = Math.max(lo, Math.min(hi, n));
    if (clamped !== n) this.drop(at, 'out_of_range', n);
    return clamped;
  }

  /**
   * Whether the quote is in the text. A blank quote points at nothing, though
   * `locate()` would find a space in any text, so it is not located.
   */
  located(quote: string): boolean {
    return quote.trim() !== '' && locate(this.text, quote) !== null;
  }

  /** Records each of `wanted` that `got` lacks, at `at`. */
  missing(at: string, wanted: Iterable<string>, got: Iterable<string>): void {
    const have = new Set(got);
    for (const id of wanted) if (!have.has(id)) this.drop(at, 'missing', id);
  }

  /** Keeps the first `max`; records the rest. */
  limit<T>(items: T[], key: string, max: number, indexOf: (item: T) => number): T[] {
    for (const item of items.slice(max)) this.drop(`${key}[${indexOf(item)}]`, 'over_limit');
    return items.slice(0, max);
  }
}

const optionalString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function dimensionScores(r: Reader, raw: Record<string, unknown>): JudgeDimensionScore[] {
  const dims = new Set(r.ids.dimensions);
  const seen = new Set<string>();
  const out: JudgeDimensionScore[] = [];
  r.list(raw, 'dimension_scores').forEach((item, i) => {
    const at = `dimension_scores[${i}]`;
    if (!isRecord(item) || typeof item.id !== 'string') return r.drop(at, 'malformed', item);
    if (!dims.has(item.id)) return r.drop(at, 'unknown_id', item.id);
    if (seen.has(item.id)) return r.drop(at, 'duplicate', item.id);
    const score = r.score(item.score, `${at}.score`, 0, 4);
    if (score === null) return;
    seen.add(item.id);
    out.push({ id: item.id, score, rationale: optionalString(item.rationale) });
  });
  r.missing(
    'dimension_scores',
    r.ids.dimensions,
    out.map((d) => d.id)
  );
  return out;
}

function highlights(r: Reader, raw: Record<string, unknown>): JudgeHighlight[] {
  const dims = new Set(r.ids.dimensions);
  const kept: { item: JudgeHighlight; i: number }[] = [];
  r.list(raw, 'highlights').forEach((item, i) => {
    const at = `highlights[${i}]`;
    if (!isRecord(item) || typeof item.quote !== 'string' || typeof item.dimension !== 'string') {
      return r.drop(at, 'malformed', item);
    }
    if (!dims.has(item.dimension)) return r.drop(at, 'unknown_id', item.dimension);
    if (!POLARITIES.some((p) => p === item.polarity)) return r.drop(at, 'malformed', item.polarity);
    if (!r.located(item.quote)) return r.drop(at, 'unlocated_quote', item.quote);
    kept.push({
      item: {
        quote: item.quote,
        dimension: item.dimension,
        polarity: String(item.polarity),
        note: optionalString(item.note),
      },
      i,
    });
  });
  return r.limit(kept, 'highlights', r.ids.maxHighlights, (k) => k.i).map((k) => k.item);
}

function recommendations(r: Reader, raw: Record<string, unknown>): JudgeRecommendation[] {
  const dims = new Set(r.ids.dimensions);
  const moves = new Set(r.ids.moves);
  const kept: { item: JudgeRecommendation; i: number }[] = [];
  r.list(raw, 'recommendations').forEach((item, i) => {
    const at = `recommendations[${i}]`;
    if (
      !isRecord(item) ||
      typeof item.dimension !== 'string' ||
      typeof item.issue !== 'string' ||
      typeof item.rewrite !== 'string' ||
      !IMPACTS.some((x) => x === item.impact)
    ) {
      return r.drop(at, 'malformed', item);
    }
    if (!dims.has(item.dimension)) return r.drop(at, 'unknown_id', item.dimension);
    let move = typeof item.move === 'string' ? item.move : '';
    if (move !== '' && !moves.has(move)) {
      r.drop(`${at}.move`, 'unknown_id', move);
      move = '';
    }
    let original = typeof item.original === 'string' ? item.original : '';
    if (original !== '' && !r.located(original)) {
      r.drop(`${at}.original`, 'unlocated_quote', original);
      original = '';
    }
    kept.push({
      item: {
        dimension: item.dimension,
        move,
        issue: item.issue,
        original,
        rewrite: item.rewrite,
        impact: String(item.impact),
      },
      i,
    });
  });
  return r.limit(kept, 'recommendations', r.ids.maxRecommendations, (k) => k.i).map((k) => k.item);
}

function redFlags(r: Reader, raw: Record<string, unknown>): JudgeRedFlag[] {
  const flags = new Set(r.ids.flags);
  const out: JudgeRedFlag[] = [];
  r.list(raw, 'red_flags').forEach((item, i) => {
    const at = `red_flags[${i}]`;
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.quote !== 'string') {
      return r.drop(at, 'malformed', item);
    }
    if (!flags.has(item.id)) return r.drop(at, 'unknown_id', item.id);
    if (!r.located(item.quote)) return r.drop(at, 'unlocated_quote', item.quote);
    out.push({ id: item.id, quote: item.quote, note: optionalString(item.note) });
  });
  return out;
}

/** Numbers by fixed key (`duties`, `text_positions`), each clamped; unknown keys dropped. */
function numbersBy(
  r: Reader,
  raw: Record<string, unknown>,
  key: string,
  keys: readonly string[],
  hi: number,
  extra: (k: string, v: unknown) => boolean = () => false
): Record<string, number | string> | undefined {
  const v = raw[key];
  if (v === undefined || v === null) return undefined;
  if (!isRecord(v)) {
    r.drop(key, 'malformed', v);
    return undefined;
  }
  const known = new Set(keys);
  const out: Record<string, number | string> = {};
  for (const [k, x] of Object.entries(v)) {
    if (extra(k, x)) continue;
    if (!known.has(k)) {
      r.drop(`${key}.${k}`, 'unknown_id', k);
      continue;
    }
    const n = r.score(x, `${key}.${k}`, 0, hi);
    if (n !== null) out[k] = n;
  }
  return out;
}

function perspectives(r: Reader, raw: Record<string, unknown>): JudgePerspective[] {
  const seen = new Set<string>();
  const out: JudgePerspective[] = [];
  r.list(raw, 'perspectives').forEach((item, i) => {
    const at = `perspectives[${i}]`;
    if (!isRecord(item) || typeof item.id !== 'string') return r.drop(at, 'malformed', item);
    const own = r.ids.perspectives.get(item.id);
    if (!own) return r.drop(at, 'unknown_id', item.id);
    if (seen.has(item.id)) return r.drop(at, 'duplicate', item.id);
    const score = r.score(item.score, `${at}.score`, 0, 4);
    if (score === null) return;
    seen.add(item.id);
    out.push({
      id: item.id,
      score,
      summary: optionalString(item.summary),
      levers: levers(r, item, at, own),
    });
  });
  r.missing(
    'perspectives',
    r.ids.perspectives.keys(),
    out.map((p) => p.id)
  );
  return out;
}

function levers(
  r: Reader,
  perspective: Record<string, unknown>,
  at: string,
  own: readonly string[]
): JudgeLever[] {
  const out = leversGiven(r, perspective, at, new Set(own));
  r.missing(
    `${at}.levers`,
    own,
    out.map((l) => l.id)
  );
  return out;
}

function leversGiven(
  r: Reader,
  perspective: Record<string, unknown>,
  at: string,
  own: ReadonlySet<string>
): JudgeLever[] {
  const raw = perspective.levers;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    r.drop(`${at}.levers`, 'malformed', raw);
    return [];
  }
  const seen = new Set<string>();
  const out: JudgeLever[] = [];
  raw.forEach((item: unknown, i) => {
    const lat = `${at}.levers[${i}]`;
    if (!isRecord(item) || typeof item.id !== 'string') return r.drop(lat, 'malformed', item);
    if (!own.has(item.id)) return r.drop(lat, 'unknown_id', item.id);
    if (seen.has(item.id)) return r.drop(lat, 'duplicate', item.id);
    if (!LEVER_STATUSES.some((s) => s === item.status)) {
      return r.drop(lat, 'malformed', item.status);
    }
    seen.add(item.id);
    const lever: JudgeLever = { id: item.id, status: String(item.status) };
    if (typeof item.quote === 'string' && item.quote !== '') {
      if (r.located(item.quote)) lever.quote = item.quote;
      else r.drop(`${lat}.quote`, 'unlocated_quote', item.quote);
    }
    const note = optionalString(item.note);
    if (note !== undefined) lever.note = note;
    out.push(lever);
  });
  return out;
}

/**
 * A slot's reply, checked against the version and the text the judge was
 * given. `reply` is the parsed JSON, untrusted.
 */
export function validateJudgeReply(
  m: EngineModel,
  slot: string,
  reply: unknown,
  text: string
): JudgeReplyValidation {
  const ids = judgeIds(m, slot);
  if (!isRecord(reply)) {
    return { ok: false, reason: 'malformed', detail: 'the reply is not a JSON object' };
  }
  const core = ids.shape === 'influence' ? 'perspectives' : 'dimension_scores';
  if (!Array.isArray(reply[core])) {
    return { ok: false, reason: 'malformed', detail: `the reply has no "${core}" list` };
  }
  const r = new Reader(text, ids);
  const output: JudgeOutput = { appeal: ids.group };
  const summary = optionalString(reply.summary);
  if (summary !== undefined) output.summary = summary;

  if (ids.shape === 'influence') {
    output.perspectives = perspectives(r, reply);
  } else {
    output.dimension_scores = dimensionScores(r, reply);
    output.highlights = highlights(r, reply);
    if (ids.shape === 'appeal') output.red_flags = redFlags(r, reply);
  }
  output.recommendations = recommendations(r, reply);

  if (ids.duties.length) {
    const duties = new Set(ids.duties);
    let primary: string | undefined;
    const d = numbersBy(r, reply, 'duties', ids.duties, 100, (k, v) => {
      if (k !== 'primary') return false;
      if (typeof v === 'string' && duties.has(v)) primary = v;
      else r.drop('duties.primary', 'unknown_id', v);
      return true;
    });
    r.missing('duties', ids.duties, Object.keys(d ?? {}));
    if (primary === undefined) r.drop('duties.primary', 'missing');
    if (d) output.duties = primary === undefined ? d : { ...d, primary };
  }
  if (ids.scales.length) {
    const positions = numbersBy(r, reply, 'text_positions', ids.scales, 1);
    r.missing('text_positions', ids.scales, Object.keys(positions ?? {}));
    if (positions) output.text_positions = positions;
  }
  return { ok: true, output, drops: r.drops };
}
