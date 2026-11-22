/**
 * Report fixtures built from the real 0.5.1 engine and a recorded baseline
 * case (a board briefing with all nine judges' outputs and culture on), so
 * the report's schemas are tested against what `assemble()` actually returns
 * and not against a hand-written guess at it.
 */
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import type { JudgeOutputs } from '@/lib/app/frameworks/howdoesthisland/engine/types';
import type { z } from 'zod';
import type { assessmentDetailSchema } from '@/lib/app/api/registry';
import { reportModelSchema, reportResultSchema } from '@/lib/app/reports/input';
import type { BuildReportInput } from '@/lib/app/reports/view';
import {
  loadCases,
  loadModel,
} from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

export const MODEL = loadModel();
const CASE_FILE = 'corpus/board-briefing-2.json';
const found = loadCases().find((c) => c.file === CASE_FILE);
if (!found) throw new Error(`baseline case ${CASE_FILE} is missing`);
export const CASE = found;
export const TEXT = CASE.input.text;
export const CTX = CASE.input.ctx;

export const ALL_JUDGES = [
  'ethos',
  'pathos',
  'logos',
  'kairos',
  'lenses',
  'influence',
  'craft',
  'audience',
  'culture',
];

/** The model document as the API serves it: with culture off, the section is left out. */
export function modelDocument(culture: boolean): Record<string, unknown> {
  if (culture) return MODEL;
  const { culture: _omitted, ...rest } = MODEL;
  return rest;
}

export const WRITTEN_EDITOR = {
  status: 'written',
  summary: {
    verdict: 'It informs, but the ask comes too late for a board.',
    changes: [
      { recommendation: 'rec_2', change: 'Lead with the decision.', why: 'Boards read the top.' },
      { recommendation: 'rec_99', change: 'Cut the history.', why: 'Nobody asked.' },
    ],
    works: ['The numbers are specific.'],
  },
  dropped: [],
  model: 'gpt-editor',
  costUsd: 0.004,
};

/** What `assemble()` returns for the case, with these judges' outputs and the editor's record. */
export function engineResult(opts: {
  judges?: readonly string[];
  culture?: boolean;
  editor?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const culture = opts.culture ?? true;
  const engine = createHowDoesThisLandEngine(MODEL, { culture });
  const judges = opts.judges ?? ALL_JUDGES;
  const outputs: JudgeOutputs = Object.fromEntries(
    judges.flatMap((j) => (CASE.judgeOutputs[j] ? [[j, CASE.judgeOutputs[j]]] : []))
  );
  const result = engine.assemble(TEXT, CTX, engine.quickScan(TEXT, CTX), outputs, null);
  // The stored result is JSON: round-trip it as the database does.
  const stored: Record<string, unknown> = JSON.parse(JSON.stringify(result));
  if (opts.editor) stored.editor = opts.editor;
  return stored;
}

/** The slots an assessment stores its judges by (`HOWDOESTHISLAND_JUDGE_SLOTS`). */
export const ALL_SLOTS = ALL_JUDGES.map((j) => `judge_${j}`);

/** The assessment as `GET /api/v1/assessments/{id}` answers: judges by slot, as stored. */
/** `GET /api/v1/assessments/{id}`'s answer, on the wire: more than the report reads. */
export type ApiAssessment = z.infer<typeof assessmentDetailSchema>;

export function apiAssessment(over: Partial<ApiAssessment> = {}): ApiAssessment {
  const judges = over.judges ?? ALL_SLOTS;
  return {
    id: 'asm_1',
    stored: true,
    status: 'completed',
    profile: 'full',
    judges,
    framework: { slug: 'howdoesthisland', version: '0.5.1' },
    projectId: null,
    title: 'Q3 board briefing',
    source: { kind: 'text', url: null, fileName: null },
    wordCount: 312,
    overall: 61,
    band: 'Solid',
    costUsd: 0.1234,
    error: null,
    errorCode: null,
    errorDetails: null,
    createdAt: '2026-11-15T09:00:00.000Z',
    startedAt: '2026-11-15T09:00:01.000Z',
    completedAt: '2026-11-15T09:01:00.000Z',
    text: TEXT,
    context: CTX,
    result: engineResult({
      judges: judges.map((s) => s.replace(/^judge_/, '')),
      editor: WRITTEN_EDITOR,
    }),
    judgeRuns: judges.map((judge) => ({
      judge,
      status: 'succeeded' as const,
      model: 'gpt-judge',
      costUsd: 0.01,
      latencyMs: 2000,
      errorCode: null,
    })),
    ...over,
  };
}

/**
 * A review whose model names nothing it is asked for and whose result leaves
 * every optional field out — the report must fall back to ids, not throw or
 * render "undefined". Built on the real result so only the degraded parts are
 * synthetic.
 */
export function degraded(): BuildReportInput {
  const base = apiAssessment();
  const result = reportResultSchema.parse(base.result);
  const model = reportModelSchema.parse(modelDocument(true));
  const [firstRun, ...otherRuns] = base.judgeRuns;
  return {
    assessment: {
      ...base,
      title: null,
      completedAt: null,
      // One reviewer never ran; another's model was not recorded.
      judgeRuns: [{ ...firstRun, model: null }, ...otherRuns.slice(1)],
    },
    result: {
      ...result,
      audience: { archetype: 'arch_unknown', role: 'role_unknown' },
      recommendations: result.recommendations.map((r) => ({ ...r, impact: 'urgent' })),
      highlights: result.highlights.map((h) => ({ ...h, flag: 'flag_unknown' })),
      red_flags: [{ id: 'flag_unknown', quote: 'q', severity: 'high', source: 'ai' }],
      dimensions: result.dimensions.map(({ rationale: _r, ...d }) => d),
      duties: { ...result.duties, target: null, fit: null },
      group_scores: {},
      perspectives: [
        {
          id: 'persp_unknown',
          score: 50,
          summary: 'Summary.',
          levers: [{ id: 'lever_unknown', status: 'present' }],
        },
      ],
      culture: result.culture ? { ...result.culture, writer: null } : null,
    },
    model: { ...model, appeals: [], judge_catalogue: [], perspectives: [], red_flags: [] },
  };
}

/** A review with nothing in any list section: no recommendations, dimensions, lenses, duties or scored perspectives. */
export function emptySections(): BuildReportInput {
  const d = degraded();
  return {
    ...d,
    result: {
      ...d.result,
      recommendations: [],
      highlights: [],
      red_flags: [],
      dimensions: [],
      lenses: {},
      duties: { ...d.result.duties, profile: {} },
      perspectives: [{ id: 'persp_unknown', score: null, summary: '', levers: [] }],
    },
  };
}
