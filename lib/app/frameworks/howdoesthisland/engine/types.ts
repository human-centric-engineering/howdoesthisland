/**
 * The engine's inputs and outputs (t-13), as the prototype's `engine.js`
 * builds them. Field names are the prototype's, snake_case included: they are
 * what the baseline records, and what the public `Assessment` schema
 * (f-assessments) will be cut from.
 */
import type {
  AppealWeights,
  Country,
  Lewis,
} from '@/lib/app/frameworks/howdoesthisland/engine/model';
import type { CraftMetrics } from '@/lib/app/frameworks/howdoesthisland/engine/craft';
import type { Sentence } from '@/lib/app/frameworks/howdoesthisland/engine/text';

/** Who the text is for. Validated where it comes in; the engine trusts it. */
export interface EngineContext {
  contentType: string;
  archetype: string;
  /** An exec role id, or empty for none. */
  role?: string;
  /** Audience modifier id → option id (`expertise: 'novice'`, …). */
  audience: Readonly<Record<string, string>>;
  /** Country ids. An unknown or empty reader is a global audience. Ignored with culture off. */
  culture?: { reader?: string; writer?: string };
}

export type Polarity = 'strength' | 'weakness';
export type Source = 'quick' | 'ai';

export interface Highlight {
  start: number;
  end: number;
  quote: string;
  dimension: string;
  /** The dimension's appeal (`lenses` for a lens), or null for an unknown id. */
  appeal: string | null;
  polarity: Polarity;
  note: string;
  source: Source;
  /** Set on a highlight raised by a red flag. */
  flag?: string;
}

export interface RedFlag {
  id: string;
  quote: string;
  /** Absent when a judge's quote cannot be found in the text. */
  start?: number;
  end?: number;
  severity: string;
  /** Absent when a judge sent none. */
  note?: string;
  source: Source;
}

export type LeverStatus = 'present' | 'absent' | 'misused' | 'not_applicable' | 'unknown';
export interface LeverState {
  status: LeverStatus;
  quote?: string;
  note?: string;
}

export interface GlobalProfile {
  id: 'global';
  name: string;
  global: true;
  lewis: Lewis;
  hofstede: null;
  targets: Record<string, number>;
  tolerance: number;
}
export type CountryProfile = Country & {
  global: false;
  targets: Record<string, number>;
  tolerance: number;
};
export type CultureProfile = GlobalProfile | CountryProfile;

export interface QuickScan {
  scores: Record<string, number>;
  notes: Record<string, string>;
  highlights: Highlight[];
  flags: RedFlag[];
  /** Duty id → share of the text's emphasis, in whole percent. */
  fns: Record<string, number>;
  levers: Record<string, LeverState>;
  /** Perspective id → 0–4, or null when none of its levers can be scanned. */
  pvScores: Record<string, number | null>;
  craft: CraftMetrics;
  sentences: Sentence[];
  words: number;
  /** Null with the culture switch off. */
  culture: {
    reader: CultureProfile;
    writer: CultureProfile | null;
    positions: Record<string, number>;
  } | null;
}

// ─── Judge outputs ──────────────────────────────────────────────────────────

/*
 * What a judge's reply may hold, as `assemble()` reads it. Deliberately as
 * loose as the prototype's reading: a score may arrive as a string, a status
 * or polarity may be one the model does not know, and an id may not exist.
 * `assemble()` coerces the first, defaults the second and drops the third.
 * Validating a reply against the model is j2's (f-judges, BRIEF §5).
 */
export interface JudgeDimensionScore {
  id: string;
  score?: number | string | null;
  rationale?: string;
}
export interface JudgeHighlight {
  quote: string;
  dimension: string;
  polarity?: string;
  note?: string;
}
export interface JudgeRecommendation {
  dimension: string;
  move?: string | null;
  issue: string;
  original?: string;
  rewrite: string;
  impact?: string;
}
export interface JudgeRedFlag {
  id: string;
  quote: string;
  note?: string;
}
export interface JudgeLever {
  id: string;
  status?: string;
  quote?: string;
  note?: string;
}
export interface JudgePerspective {
  id: string;
  score?: number | string | null;
  summary?: string;
  levers?: JudgeLever[];
}

/** One judge's reply. The influence judge's carries `perspectives`; the others' do not. */
export interface JudgeOutput {
  appeal?: string;
  summary?: string;
  dimension_scores?: JudgeDimensionScore[];
  highlights?: JudgeHighlight[];
  recommendations?: JudgeRecommendation[];
  red_flags?: JudgeRedFlag[];
  /** Lenses judge: duty id → emphasis. */
  duties?: Record<string, number | string>;
  /** Culture judge: scale id → position, 0–1. */
  text_positions?: Record<string, unknown>;
  perspectives?: JudgePerspective[];
}

/** Judge group (`ethos`, …, `influence`) → its reply. */
export type JudgeOutputs = Readonly<Record<string, JudgeOutput | undefined>>;

// ─── The assembled assessment ───────────────────────────────────────────────

export interface Recommendation {
  appeal: string;
  dimension: string;
  move: string | null;
  issue: string;
  original: string;
  rewrite: string;
  impact: string;
  source: 'library' | 'ai';
  /** Library recommendations only: the original is the model's example, not the text's. */
  example?: boolean;
}

export interface CultureReport {
  reader: {
    id: string;
    name: string;
    global: boolean;
    lewis: Lewis;
    lewis_label: string;
    hofstede: Country['hofstede'] | null;
    targets: Record<string, number>;
    tolerance: number;
  };
  writer: { id: string; name: string; lewis: Lewis; targets: Record<string, number> } | null;
  positions: Record<string, number>;
  gaps: { scale: string; writer: number; reader: number; diff: number }[];
  source: Source;
}

export interface Assessment {
  model_version: string;
  mode: 'full' | 'quick';
  content_type: string;
  audience: { archetype: string; role: string | null; [modifier: string]: string | null };
  effective_weights: AppealWeights;
  scores: {
    overall: number;
    band: string;
    balance_index: number;
  } & AppealWeights;
  lenses: Record<string, number>;
  duties: {
    profile: Record<string, number>;
    primary: string;
    target: Record<string, number> | null;
    fit: number | null;
    source: Source;
  };
  appeal_share: Record<string, number>;
  craft: CraftMetrics;
  group_scores: Record<string, number>;
  /** Null with the culture switch off. */
  culture: CultureReport | null;
  dimensions: {
    id: string;
    appeal: string | null;
    score: number;
    rationale: string | undefined;
    source: Source;
  }[];
  perspectives: {
    id: string;
    score: number | null;
    summary: string;
    levers: ({ id: string } & LeverState)[];
  }[];
  perspectives_source: Source;
  highlights: Highlight[];
  recommendations: Recommendation[];
  balance_findings: { id: string; name: string; message: string }[];
  red_flags: RedFlag[];
  judges: Record<string, string>;
  source: string | null;
}
