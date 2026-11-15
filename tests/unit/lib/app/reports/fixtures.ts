/**
 * Report fixtures built from the real 0.5.1 engine and a recorded baseline
 * case (a board briefing with all nine judges' outputs and culture on), so
 * the report's schemas are tested against what `assemble()` actually returns
 * and not against a hand-written guess at it.
 */
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import type { JudgeOutputs } from '@/lib/app/frameworks/howdoesthisland/engine/types';
import type { ReportAssessment } from '@/lib/app/reports/input';
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

/** The assessment as `GET /api/v1/assessments/{id}` answers. */
export function apiAssessment(over: Partial<ReportAssessment> = {}): ReportAssessment {
  const judges = over.judges ?? ALL_JUDGES;
  return {
    id: 'asm_1',
    stored: true,
    status: 'completed',
    profile: 'full',
    judges,
    framework: { slug: 'howdoesthisland', version: '0.5.1' },
    title: 'Q3 board briefing',
    source: { kind: 'text', url: null, fileName: null },
    wordCount: 312,
    overall: 61,
    band: 'Solid',
    costUsd: 0.1234,
    error: null,
    createdAt: '2026-11-15T09:00:00.000Z',
    startedAt: '2026-11-15T09:00:01.000Z',
    completedAt: '2026-11-15T09:01:00.000Z',
    text: TEXT,
    context: CTX,
    result: engineResult({ judges, editor: WRITTEN_EDITOR }),
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
