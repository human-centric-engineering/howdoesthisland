/**
 * A comparison as `GET /api/v1/comparisons/{id}` serves it (t-87, t-88), for
 * the `/compare/[id]` tests (t-89). `schemas.test.ts` holds it to the wire
 * contract (`comparisonDetailSchema`), so the page is tested on what the API
 * actually sends.
 */
import type { Comparison } from '@/components/app/compare/schemas';

type Wire = Comparison & {
  kind: 'comparison';
  profile: string;
  judges: string[];
  projectId: string | null;
  context: Record<string, unknown>;
  verdict: Comparison['verdict'] & {
    model: string | null;
    costUsd: number;
    completedAt: string | null;
  };
};

const scores = (ethos: number, pathos: number, logos: number, kairos: number) => [
  { appeal: 'ethos', score: ethos },
  { appeal: 'pathos', score: pathos },
  { appeal: 'logos', score: logos },
  { appeal: 'kairos', score: kairos },
];

/** Three drafts, all reviewed, the second landing better. */
export function aComparison(overrides: Partial<Wire> = {}): Wire {
  return {
    id: 'cmp-1',
    kind: 'comparison',
    status: 'completed',
    framework: { slug: 'howdoesthisland', version: '0.5.2' },
    profile: 'full',
    judges: ['judge_ethos', 'judge_pathos'],
    projectId: null,
    project: null,
    context: {},
    createdAt: '2026-11-25T10:00:00.000Z',
    drafts: [
      {
        position: 0,
        label: 'Subject A',
        assessmentId: 'a-0',
        status: 'completed',
        overall: 62,
        band: 'Mixed',
        appeals: scores(60, 55, 70, 58),
      },
      {
        position: 1,
        label: null,
        assessmentId: 'a-1',
        status: 'completed',
        overall: 74,
        band: 'Lands well',
        appeals: scores(72, 68, 70, 80),
      },
      {
        position: 2,
        label: 'Subject C',
        assessmentId: 'a-2',
        status: 'completed',
        overall: 51,
        band: 'Mixed',
        appeals: scores(50, 40, 64, 52),
      },
    ],
    appeals: [
      {
        appeal: 'ethos',
        leaders: [1],
        drafts: [
          { position: 0, score: 60, delta: -12 },
          { position: 1, score: 72, delta: 0 },
          { position: 2, score: 50, delta: -22 },
        ],
      },
      {
        appeal: 'pathos',
        leaders: [1],
        drafts: [
          { position: 0, score: 55, delta: -13 },
          { position: 1, score: 68, delta: 0 },
          { position: 2, score: 40, delta: -28 },
        ],
      },
      {
        appeal: 'logos',
        // A tie: both lead.
        leaders: [0, 1],
        drafts: [
          { position: 0, score: 70, delta: 0 },
          { position: 1, score: 70, delta: 0 },
          { position: 2, score: 64, delta: -6 },
        ],
      },
      {
        appeal: 'kairos',
        leaders: [1],
        drafts: [
          { position: 0, score: 58, delta: -22 },
          { position: 1, score: 80, delta: 0 },
          { position: 2, score: 52, delta: -28 },
        ],
      },
    ],
    verdict: {
      status: 'completed',
      draft: 1,
      why: 'It names the reader’s problem first and gives a price.',
      appeals: [{ appeal: 'kairos', why: 'It says why now: the tax deadline.' }],
      reason: null,
      model: 'editor-model',
      costUsd: 0.01,
      completedAt: '2026-11-25T10:05:00.000Z',
    },
    ...overrides,
  };
}

/** The same three drafts while the second and third are still being reviewed. */
export function aRunningComparison(): Wire {
  const done = aComparison();
  return aComparison({
    status: 'running',
    drafts: [
      done.drafts[0],
      { ...done.drafts[1], status: 'running', overall: null, band: null, appeals: null },
      { ...done.drafts[2], status: 'queued', overall: null, band: null, appeals: null },
    ],
    appeals: [],
    verdict: {
      ...done.verdict,
      status: 'waiting',
      draft: null,
      why: null,
      appeals: [],
      completedAt: null,
      costUsd: 0,
      model: null,
    },
  });
}

export const APPEAL_NAMES = {
  ethos: 'Credibility',
  pathos: 'Emotion',
  logos: 'Logic',
  kairos: 'Timing',
};

/**
 * A row of `GET /api/v1/comparisons` (t-90): the summary the list sends, held
 * to `comparisonSummarySchema` in `schemas.test.ts`. By default `aComparison`'s
 * three drafts, the second chosen.
 */
export function aComparisonRow(overrides: Partial<SummaryWire> = {}): SummaryWire {
  const { id, kind, status, framework, profile, judges, projectId, project, createdAt } =
    aComparison();
  return {
    id,
    kind,
    status,
    framework,
    profile,
    judges,
    projectId,
    project,
    createdAt,
    drafts: aComparison().drafts.map(({ appeals: _appeals, ...draft }) => draft),
    verdict: { status: 'completed', draft: 1 },
    ...overrides,
  };
}

type SummaryWire = Pick<
  Wire,
  | 'id'
  | 'kind'
  | 'status'
  | 'framework'
  | 'profile'
  | 'judges'
  | 'projectId'
  | 'project'
  | 'createdAt'
> & {
  drafts: Array<Omit<Wire['drafts'][number], 'appeals'>>;
  verdict: Pick<Wire['verdict'], 'status' | 'draft'>;
};
