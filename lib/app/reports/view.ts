/**
 * The report, as the page renders it (t-29, app-plan §8.5).
 *
 * {@link buildReportView} turns the two API answers into the report's sections:
 * every id named from the model, notes placed in the copy, recommendations by
 * impact. It is pure, so the rules are tested here and not in the components:
 *
 * - **A section a result does not have is absent**, not empty: no editor's
 *   summary for a quick or single-judge run, no culture with the switch off,
 *   no influence perspectives when nothing could score them.
 * - **Context used** (f-projects) and the version's **calibration status**
 *   (f-calibration) are not built yet. They have no data, so they are not
 *   sections at all.
 * - **A note whose offsets do not fit the copy is listed but not marked.**
 *   The engine locates every quote, so this means the copy and the result
 *   disagree. Marking the wrong words would be worse than not marking them.
 */
import type {
  ReportAssessment,
  ReportModel,
  ReportRecommendation,
  ReportResult,
} from '@/lib/app/reports/input';
import { sharesOf } from '@/lib/app/reports/shares';
import { overlayShapeSchema } from '@/lib/app/frameworks/howdoesthisland/engine/overlay';

export const APPEAL_IDS = ['ethos', 'pathos', 'logos', 'kairos'] as const;

/** The dimension scale's top (model `scoring.dimension_scale`: 0–4). */
export const DIMENSION_MAX = 4;

export interface ReportNote {
  /** 1-based, as the margin numbers it. */
  number: number;
  polarity: 'strength' | 'weakness';
  note: string;
  quote: string;
  dimensionId: string;
  dimensionName: string;
  /** Whether the report shows that dimension, so a link to it lands somewhere. */
  dimensionShown: boolean;
  /** The recommendation on the same dimension, by its number, if there is one. */
  recommendation: number | null;
  fromQuickScan: boolean;
  /** The red flag that raised it, named. */
  flag: string | null;
  /** Whether the note is marked in the copy (its offsets fit). */
  placed: boolean;
}

/** A run of the copy, and the notes (by number) that cover it. */
export interface CopySegment {
  text: string;
  notes: number[];
}

export interface ReportRecommendationView {
  /** The recommendation's place in the result, 1-based: the editor names it `rec_<number>`. */
  number: number;
  appealId: string;
  appealName: string;
  dimensionId: string;
  dimensionName: string;
  move: string | null;
  issue: string;
  original: string;
  rewrite: string;
  impact: string;
  /** The original is the model's example, not a line of this copy. */
  example: boolean;
}

export interface DimensionGroup {
  id: string;
  name: string;
  /** The appeal's or group's score, 0–100, where the result has one. */
  score: number | null;
  /** That judge's summary paragraph. */
  summary: string | null;
  rows: {
    id: string;
    name: string;
    score: number;
    rationale: string | null;
    fromQuickScan: boolean;
  }[];
}

export interface ReviewerView {
  slot: string;
  name: string;
  status: 'succeeded' | 'failed' | 'not_run';
  model: string | null;
}

export interface ReportView {
  status: ReportAssessment['status'];
  mode: 'full' | 'quick';
  cover: {
    title: string | null;
    typeOfCopy: string;
    audience: string[];
    date: string;
    framework: string;
    wordCount: number;
    /**
     * The project's adjustment to the weights it was scored with (t-72), one
     * phrase per change ("Ethos +10 points", "Integrity made a
     * priority"), or `null` when none applied.
     */
    weighting: string[] | null;
  };
  verdict: {
    overall: number;
    band: string;
    editor: {
      verdict: string;
      changes: { change: string; why: string; recommendation: number | null }[];
      works: string[];
    } | null;
  };
  lands: {
    /**
     * `share` is the appeal's share of the four scores and `target` its weight
     * in the target mix, both whole percentages adding to exactly 100: the two
     * mixes the balance index compares.
     */
    appeals: {
      id: string;
      name: string;
      question: string;
      score: number;
      share: number;
      target: number;
    }[];
    balanceIndex: number;
    caps: { appealName: string; cap: number; why: string }[];
    findings: { name: string; message: string }[];
  };
  copy: { segments: CopySegment[]; notes: ReportNote[] };
  recommendations: ReportRecommendationView[];
  flags: { id: string; name: string; severity: string; quote: string; note: string | null }[];
  dimensions: DimensionGroup[];
  lenses: { id: string; name: string; tagline: string; score: number }[];
  duties: {
    primary: string;
    fit: number | null;
    rows: { id: string; name: string; verb: string; share: number; target: number | null }[];
  };
  /** The lenses and influence judges' own paragraphs, when they answered. */
  summaries: { lenses: string | null; influence: string | null };
  perspectives: {
    id: string;
    name: string;
    question: string;
    score: number | null;
    summary: string;
    levers: {
      id: string;
      name: string;
      status: string;
      quote: string | null;
      note: string | null;
    }[];
  }[];
  craft: { label: string; value: string }[];
  culture: {
    reader: string;
    writer: string | null;
    style: string;
    scales: {
      id: string;
      name: string;
      low: string;
      high: string;
      position: number;
      target: number;
    }[];
  } | null;
  method: {
    reviewers: ReviewerView[];
    fellBack: string[];
    editor: { status: 'written' | 'skipped' | 'failed'; model: string | null } | null;
    framework: string;
    interpretation: string;
    limitations: { title: string; detail: string }[];
    /** `null` when the input carried none: a shared report's. */
    costUsd: number | null;
  };
}

type Names = ReadonlyMap<string, string>;

const namesOf = (items: readonly { id: string; name: string }[]): Names =>
  new Map(items.map((i) => [i.id, i.name]));

const nameIn = (names: Names, id: string): string => names.get(id) ?? id;

/** How much a recommendation matters, for ordering: unknown impacts go last. */
const IMPACT_ORDER: Readonly<Record<string, number>> = { high: 0, medium: 1, low: 2 };
const impactRank = (impact: string): number => IMPACT_ORDER[impact.toLowerCase()] ?? 3;

/** `rec_3` → 3, as the editor names a recommendation (`engine/editor.ts`). */
export function recommendationNumber(ref: string, count: number): number | null {
  const match = /^rec_(\d+)$/.exec(ref);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= count ? n : null;
}

/** Split the copy at every note boundary, each run carrying the notes that cover it. */
export function segmentCopy(
  text: string,
  marks: readonly { number: number; start: number; end: number }[]
): CopySegment[] {
  const cuts = new Set<number>([0, text.length]);
  for (const m of marks) {
    cuts.add(m.start);
    cuts.add(m.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: CopySegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const notes = marks.filter((m) => m.start <= from && m.end >= to).map((m) => m.number);
    segments.push({ text: text.slice(from, to), notes });
  }
  return segments;
}

const fits = (text: string, start: number, end: number): boolean =>
  start >= 0 && start < end && end <= text.length;

/**
 * The name a judge goes by: its appeal's, else its catalogue entry's. Takes a
 * stored slot (`judge_ethos`, resolved through the model's `judges`) or the
 * appeal or group it judges (`ethos`, `influence`), as a recommendation names it.
 */
function reviewerName(model: ReportModel, appeals: Names, slotOrGroup: string): string {
  const group = model.judges.find((j) => j.id === slotOrGroup)?.appeal ?? slotOrGroup;
  const appeal = appeals.get(group);
  if (appeal) return appeal;
  const entry = model.judge_catalogue.find((c) => c.judges.length === 1 && c.judges[0] === group);
  return entry?.name ?? slotOrGroup;
}

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Points of the mix, signed: `+10 points`, `−5 points`. The sign is the
 * delta's own, taken before rounding, and a move under a tenth of a point is
 * said as such rather than rounded to `0`.
 */
function signedPoints(share: number): string {
  const sign = share > 0 ? '+' : '−';
  const p = Math.abs(+(share * 100).toFixed(1));
  if (p === 0) return `${sign}under 0.1 points`;
  return `${sign}${p} point${p === 1 ? '' : 's'}`;
}

/**
 * The overlay as the cover names it, or `null` for none. An overlay this
 * report cannot read (another framework's shape) is named as an adjustment
 * without its detail, rather than hidden: the scores were still weighted by it.
 */
function weightingOf(overlay: unknown, appeals: Names, dims: Names): string[] | null {
  if (overlay === null || overlay === undefined) return null;
  const parsed = overlayShapeSchema.safeParse(overlay);
  if (!parsed.success) return ['Adjusted for this project'];
  const { weights, priorityDimensions } = parsed.data;
  const out: string[] = [];
  for (const a of APPEAL_IDS) {
    const d = weights?.[a];
    if (d) out.push(`${nameIn(appeals, a)} ${signedPoints(d)}`);
  }
  for (const id of priorityDimensions?.add ?? []) out.push(`${nameIn(dims, id)} made a priority`);
  for (const id of priorityDimensions?.remove ?? [])
    out.push(`${nameIn(dims, id)} no longer a priority`);
  return out.length > 0 ? out : null;
}

export interface BuildReportInput {
  assessment: ReportAssessment;
  result: ReportResult;
  model: ReportModel;
}

export function buildReportView({ assessment, result, model }: BuildReportInput): ReportView {
  const appeals = namesOf(model.appeals);
  const dims = namesOf([...model.dimensions, ...model.extra_dimensions, ...model.lenses]);
  const moves = namesOf(model.moves);
  const flags = namesOf(model.red_flags);
  const groups = namesOf(model.groups);
  // A recommendation's `appeal` is an appeal, a group, or a judge's own slot
  // (lenses, influence): name it from whichever the model has.
  const groupName = (id: string): string =>
    appeals.get(id) ?? groups.get(id) ?? reviewerName(model, appeals, id);

  // Cover
  const audience: string[] = [];
  const { archetype, role, ...modifiers } = result.audience;
  if (archetype) audience.push(nameIn(namesOf(model.archetypes), archetype));
  if (role) audience.push(nameIn(namesOf(model.exec_roles), role));
  for (const mod of model.audience_modifiers) {
    const chosen = modifiers[mod.id];
    const option = chosen ? mod.options.find((o) => o.id === chosen) : undefined;
    if (option) audience.push(option.label);
  }

  // Recommendations: numbered in result order (the editor's ids), shown by impact.
  // A note links to the recommendation on its dimension that is shown first (by impact).
  const recByDimension = new Map<string, number>();
  const recommendations = result.recommendations.map(
    (r: ReportRecommendation, i): ReportRecommendationView => {
      const number = i + 1;
      return {
        number,
        appealId: r.appeal,
        appealName: groupName(r.appeal),
        dimensionId: r.dimension,
        dimensionName: nameIn(dims, r.dimension),
        move: r.move ? nameIn(moves, r.move) : null,
        issue: r.issue,
        original: r.original,
        rewrite: r.rewrite,
        impact: r.impact,
        example: r.example === true,
      };
    }
  );
  const byImpact = recommendations
    .map((r, i) => ({ r, i }))
    .sort((a, b) => impactRank(a.r.impact) - impactRank(b.r.impact) || a.i - b.i)
    .map(({ r }) => r);
  for (const r of byImpact) {
    if (!recByDimension.has(r.dimensionId)) recByDimension.set(r.dimensionId, r.number);
  }

  // Notes, placed in the copy
  const notes: Omit<ReportNote, 'dimensionShown'>[] = result.highlights.map((h, i) => ({
    number: i + 1,
    polarity: h.polarity,
    note: h.note,
    quote: h.quote,
    dimensionId: h.dimension,
    dimensionName: nameIn(dims, h.dimension),
    recommendation: recByDimension.get(h.dimension) ?? null,
    fromQuickScan: h.source === 'quick',
    flag: h.flag ? nameIn(flags, h.flag) : null,
    placed: fits(assessment.text, h.start, h.end),
  }));
  const marks = result.highlights
    .map((h, i) => ({ number: i + 1, start: h.start, end: h.end }))
    .filter((m) => notes[m.number - 1].placed);

  // Editor
  const editorRecord = result.editor;
  const editor =
    editorRecord?.status === 'written'
      ? {
          verdict: editorRecord.summary.verdict,
          changes: editorRecord.summary.changes.map((c) => ({
            change: c.change,
            why: c.why,
            recommendation: recommendationNumber(c.recommendation, recommendations.length),
          })),
          works: editorRecord.summary.works,
        }
      : null;

  // How it lands
  const appealShares = sharesOf(APPEAL_IDS.map((id) => result.scores[id]));
  const appealTargets = sharesOf(APPEAL_IDS.map((id) => result.effective_weights[id]));
  const landsAppeals = APPEAL_IDS.map((id, i) => {
    const def = model.appeals.find((a) => a.id === id);
    return {
      id,
      name: def?.name ?? id,
      question: def?.question ?? '',
      score: result.scores[id],
      share: appealShares[i],
      target: appealTargets[i],
    };
  });
  const dimScore = new Map(result.dimensions.map((d) => [d.id, d.score]));
  const appealScores = new Map<string, number>(landsAppeals.map((a) => [a.id, a.score]));
  const caps = model.scoring.integrity_caps
    .filter((c) => {
      const s = dimScore.get(c.dimension);
      // The engine takes min(score, cap), so a cap changed the appeal only
      // when the appeal sits at it; below it, the cap did nothing.
      const appealScore = appealScores.get(c.appeal);
      return (
        s !== undefined && s <= c.if_at_most && appealScore !== undefined && appealScore >= c.cap
      );
    })
    .map((c) => ({ appealName: nameIn(appeals, c.appeal), cap: c.cap, why: c.why }));

  // Dimensions, by appeal then group, in the model's order
  const groupOrder = [...APPEAL_IDS, ...model.groups.map((g) => g.id)];
  const dimensionGroups: DimensionGroup[] = [];
  for (const groupId of groupOrder) {
    const rows = result.dimensions
      .filter((d) => d.appeal === groupId)
      .map((d) => ({
        id: d.id,
        name: nameIn(dims, d.id),
        score: d.score,
        rationale: d.rationale ?? null,
        fromQuickScan: d.source === 'quick',
      }));
    if (rows.length === 0) continue;
    const isAppeal = (APPEAL_IDS as readonly string[]).includes(groupId);
    dimensionGroups.push({
      id: groupId,
      name: isAppeal ? nameIn(appeals, groupId) : nameIn(groups, groupId),
      score: isAppeal
        ? result.scores[groupId as (typeof APPEAL_IDS)[number]]
        : (result.group_scores[groupId] ?? null),
      summary: result.judges[groupId] ?? null,
      rows,
    });
  }

  // Lenses and duties
  const lenses = model.lenses
    .filter((l) => result.lenses[l.id] !== undefined)
    .map((l) => ({ id: l.id, name: l.name, tagline: l.tagline, score: result.lenses[l.id] }));
  const dutyNames = namesOf(model.duties);
  const duties = {
    primary: nameIn(dutyNames, result.duties.primary),
    fit: result.duties.fit,
    rows: model.duties
      .filter((d) => result.duties.profile[d.id] !== undefined)
      .map((d) => ({
        id: d.id,
        name: d.name,
        verb: d.verb,
        share: result.duties.profile[d.id],
        target: result.duties.target?.[d.id] ?? null,
      })),
  };

  // Influence perspectives: only when at least one could be scored
  const perspectives = result.perspectives.some((p) => p.score !== null)
    ? result.perspectives.map((p) => {
        const def = model.perspectives.find((d) => d.id === p.id);
        const levers = namesOf(def?.levers ?? []);
        return {
          id: p.id,
          name: def?.name ?? p.id,
          question: def?.question ?? '',
          score: p.score,
          summary: p.summary,
          levers: p.levers
            .filter((l) => l.status !== 'unknown' && l.status !== 'not_applicable')
            .map((l) => ({
              id: l.id,
              name: nameIn(levers, l.id),
              status: l.status,
              quote: l.quote ?? null,
              note: l.note ?? null,
            })),
        };
      })
    : [];

  const c = result.craft;
  const craft = [
    // Counted by the engine's tokeniser, which can differ from intake's count on the cover.
    { label: 'Words scored', value: String(c.words) },
    { label: 'Sentences', value: String(c.sentences) },
    { label: 'Average sentence', value: `${c.avg_sentence.toFixed(1)} words` },
    { label: 'Speaking time', value: formatSeconds(c.speaking_sec) },
    { label: 'Gunning Fog index', value: c.gunning_fog.toFixed(1) },
    { label: 'Flesch–Kincaid grade', value: c.fk_grade.toFixed(1) },
    { label: 'Passive voice', value: `${Math.round(c.passive_pct)}%` },
    { label: 'Emotional words', value: `${c.emotional_pct.toFixed(1)}%` },
  ];

  const culture =
    result.culture && model.culture
      ? {
          reader: result.culture.reader.name,
          writer: result.culture.writer?.name ?? null,
          style: result.culture.reader.lewis_label,
          scales: model.culture.scales
            .filter((s) => result.culture?.positions[s.id] !== undefined)
            .map((s) => ({
              id: s.id,
              name: s.name,
              low: s.low,
              high: s.high,
              position: result.culture?.positions[s.id] ?? 0,
              target: result.culture?.reader.targets[s.id] ?? 0,
            })),
        }
      : null;

  // The dimensions the report has an anchor for: the Dimensions rows and the lenses.
  const shownDimensions = new Set([
    ...dimensionGroups.flatMap((g) => g.rows.map((r) => r.id)),
    ...lenses.map((l) => l.id),
  ]);

  // Method
  const runs = new Map(assessment.judgeRuns.map((r) => [r.judge, r]));
  const reviewers: ReviewerView[] = assessment.judges.map((slot) => {
    const run = runs.get(slot);
    return {
      slot,
      name: reviewerName(model, appeals, slot),
      status: run ? run.status : 'not_run',
      model: run?.model ?? null,
    };
  });
  const editorMethod = editorRecord
    ? {
        status: editorRecord.status,
        model: editorRecord.status === 'skipped' ? null : editorRecord.model,
      }
    : null;

  return {
    status: assessment.status,
    mode: result.mode,
    cover: {
      title: assessment.title,
      typeOfCopy: nameIn(namesOf(model.content_types), result.content_type),
      audience,
      date: assessment.completedAt ?? assessment.createdAt,
      framework: `${model.meta.name} ${model.meta.version}`,
      wordCount: assessment.wordCount,
      weighting: weightingOf(assessment.overlay, appeals, dims),
    },
    verdict: { overall: result.scores.overall, band: result.scores.band, editor },
    lands: {
      appeals: landsAppeals,
      balanceIndex: result.scores.balance_index,
      caps,
      findings: result.balance_findings.map((f) => ({ name: f.name, message: f.message })),
    },
    copy: {
      segments: segmentCopy(assessment.text, marks),
      notes: notes.map((n) => ({ ...n, dimensionShown: shownDimensions.has(n.dimensionId) })),
    },
    recommendations: byImpact,
    flags: result.red_flags.map((f) => ({
      id: f.id,
      name: nameIn(flags, f.id),
      severity: f.severity,
      quote: f.quote,
      note: f.note ?? null,
    })),
    dimensions: dimensionGroups,
    lenses,
    duties,
    summaries: { lenses: result.judges.lenses ?? null, influence: result.judges.influence ?? null },
    perspectives,
    craft,
    culture,
    method: {
      reviewers,
      fellBack: reviewers.filter((r) => r.status !== 'succeeded').map((r) => r.name),
      editor: editorMethod,
      framework: `${model.meta.name} ${model.meta.version}`,
      interpretation: model.scoring.interpretation,
      limitations: model.limitations.map((l) => ({ title: l.title, detail: l.detail })),
      costUsd: assessment.costUsd ?? null,
    },
  };
}
