/**
 * What `get_assessment` and `assess_draft` answer about a review (t-92): the
 * report's own words, trimmed to what an assistant can use. `loadReport` is
 * mocked; its parsing is the report's tests'. These pin which of the report's
 * fields reach the assistant, and each state's answer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loadReport: vi.fn(), model: vi.fn(), getAssessment: vi.fn() }));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }));
vi.mock('@/lib/app/reports/load', () => ({ loadReport: mocks.loadReport }));
vi.mock('@/lib/app/reports/pdf/print-source', () => ({
  asOnTheWire: (v: unknown) => JSON.parse(JSON.stringify(v)),
  printReportSource: { model: mocks.model },
}));
vi.mock('@/lib/app/assessments/api/service', () => ({ getAssessment: mocks.getAssessment }));

import {
  readAssessmentSummary,
  summariseAssessment,
  SUMMARY_RECOMMENDATIONS,
} from '@/lib/app/mcp/assessment-summary';
import type { AssessmentDetail } from '@/lib/app/assessments/api/views';
import type { ReportView } from '@/lib/app/reports/view';

function detail(over: Partial<AssessmentDetail> = {}): AssessmentDetail {
  return {
    id: 'a 1',
    stored: true,
    status: 'completed',
    profile: 'standard',
    judges: ['ethos'],
    framework: { slug: 'howdoesthisland', version: '0.5.1' },
    projectId: null,
    project: null,
    title: 'Launch email',
    source: { kind: 'text', url: null, fileName: null },
    wordCount: 120,
    overall: 62,
    band: 'Fair',
    costUsd: 0.4,
    error: null,
    errorCode: null,
    errorDetails: null,
    createdAt: new Date('2026-11-26T10:00:00Z'),
    startedAt: null,
    completedAt: new Date('2026-11-26T10:02:00Z'),
    text: 'Our platform will revolutionise how teams work.',
    context: {},
    overlay: null,
    contextUsed: null,
    result: { any: 'shape' },
    quickScan: null,
    judgeRuns: [],
    ...over,
  };
}

const recommendation = (n: number) => ({
  number: n,
  appealId: 'logos',
  appealName: 'Logos',
  dimensionId: 'evidence',
  dimensionName: 'Evidence',
  move: null,
  issue: `Issue ${n}`,
  original: 'revolutionise how teams work',
  rewrite: 'save each team four hours a week',
  impact: 'A number the reader can check.',
  // The second is the model's illustration, not a line of the draft.
  example: n === 2,
});

function view(recommendations = 2): ReportView {
  return {
    status: 'completed',
    mode: 'full',
    cover: {
      title: 'Launch email',
      typeOfCopy: 'Sales email',
      audience: [],
      date: '26 Nov',
      framework: 'x',
      wordCount: 120,
      weighting: null,
    },
    verdict: {
      overall: 62,
      band: 'Fair',
      editor: {
        verdict: 'Credible, but it claims more than it shows.',
        changes: [
          { change: 'Lead with Sarah’s four hours', why: 'Proof first', recommendation: 1 },
        ],
        works: ['A clear ask'],
      },
    },
    lands: {
      appeals: [
        {
          id: 'logos',
          name: 'Logos',
          question: 'Does it add up?',
          score: 55,
          share: 25,
          target: 30,
        },
      ],
      balanceIndex: 80,
      caps: [],
      findings: [],
    },
    copy: { segments: [], notes: [] },
    recommendations: Array.from({ length: recommendations }, (_, i) => recommendation(i + 1)),
    flags: [{ id: 'hype', name: 'Hype', severity: 'medium', quote: 'revolutionise', note: null }],
    dimensions: [],
    lenses: [],
  } as unknown as ReportView;
}

afterEach(() => vi.clearAllMocks());

describe('a finished review', () => {
  it('answers the report’s verdict, changes, appeals, recommendations and flags', async () => {
    mocks.loadReport.mockResolvedValue({ kind: 'ready', view: view(), projectId: null });

    const summary = await summariseAssessment(detail());

    expect(summary).toEqual({
      id: 'a 1',
      status: 'completed',
      title: 'Launch email',
      reportUrl: 'https://app.test/assessments/a%201',
      ready: true,
      overall: 62,
      band: 'Fair',
      wordCount: 120,
      verdict: 'Credible, but it claims more than it shows.',
      changes: [{ change: 'Lead with Sarah’s four hours', why: 'Proof first' }],
      works: ['A clear ask'],
      appeals: [{ name: 'Logos', score: 55, question: 'Does it add up?' }],
      recommendations: [1, 2].map((n) => ({
        appeal: 'Logos',
        dimension: 'Evidence',
        issue: `Issue ${n}`,
        original: 'revolutionise how teams work',
        rewrite: 'save each team four hours a week',
        impact: 'A number the reader can check.',
        example: n === 2,
      })),
      moreRecommendations: 0,
      flags: [{ name: 'Hype', severity: 'medium', quote: 'revolutionise', note: null }],
    });
  });

  it('hands the report the detail already read, not a second read', async () => {
    mocks.loadReport.mockResolvedValue({ kind: 'ready', view: view(), projectId: null });
    mocks.model.mockResolvedValue({ the: 'model' });

    await summariseAssessment(detail());

    const [id, source] = mocks.loadReport.mock.calls[0] as [
      string,
      {
        assessment: (id: string) => Promise<unknown>;
        model: (s: string, v: string) => Promise<unknown>;
      },
    ];
    expect(id).toBe('a 1');
    await expect(source.assessment(id)).resolves.toMatchObject({
      id: 'a 1',
      title: 'Launch email',
    });
    await expect(source.model('howdoesthisland', '0.5.1')).resolves.toEqual({ the: 'model' });
    expect(mocks.model).toHaveBeenCalledWith('howdoesthisland', '0.5.1');
    expect(mocks.getAssessment).not.toHaveBeenCalled();
  });

  it(`carries at most ${SUMMARY_RECOMMENDATIONS} recommendations and counts the rest`, async () => {
    mocks.loadReport.mockResolvedValue({
      kind: 'ready',
      view: view(SUMMARY_RECOMMENDATIONS + 3),
      projectId: null,
    });

    const summary = await summariseAssessment(detail());

    expect(summary.ready && summary.recommendations).toHaveLength(SUMMARY_RECOMMENDATIONS);
    expect(summary.ready && summary.moreRecommendations).toBe(3);
  });

  it('answers a quick-scan review, which has no editor, with no verdict', async () => {
    const quick = view();
    quick.verdict.editor = null;
    mocks.loadReport.mockResolvedValue({ kind: 'ready', view: quick, projectId: null });

    const summary = await summariseAssessment(detail({ profile: 'quick' }));

    expect(summary).toMatchObject({ ready: true, verdict: null, changes: [], works: [] });
  });

  it('answers a result the report cannot read as having none, pointing at the report', async () => {
    mocks.loadReport.mockResolvedValue({ kind: 'unreadable' });

    const summary = await summariseAssessment(detail());

    expect(summary).toEqual({
      id: 'a 1',
      status: 'completed',
      title: 'Launch email',
      reportUrl: 'https://app.test/assessments/a%201',
      ready: false,
      error: expect.stringContaining('Open the report'),
      errorCode: null,
    });
  });
});

describe('a review with no result', () => {
  it('answers why: refused for credits', async () => {
    mocks.loadReport.mockResolvedValue({ kind: 'no_result', assessment: {} });

    const summary = await summariseAssessment(
      detail({
        status: 'failed',
        result: null,
        error: 'No review credits left.',
        errorCode: 'INSUFFICIENT_CREDITS',
      })
    );

    expect(summary).toMatchObject({
      ready: false,
      status: 'failed',
      error: 'No review credits left.',
      errorCode: 'INSUFFICIENT_CREDITS',
    });
  });
});

describe('a review still running', () => {
  it('says to ask again, with the quick scan’s early read, without loading the report', async () => {
    const summary = await summariseAssessment(
      detail({
        status: 'running',
        result: null,
        completedAt: null,
        quickScan: { overall: 48, band: 'Weak', result: {} },
      })
    );

    expect(summary).toEqual({
      id: 'a 1',
      status: 'running',
      title: 'Launch email',
      reportUrl: 'https://app.test/assessments/a%201',
      ready: false,
      next: expect.stringContaining('get_assessment'),
      early: { overall: 48, band: 'Weak' },
    });
    expect(mocks.loadReport).not.toHaveBeenCalled();
  });

  it('answers no early read when there is none', async () => {
    const summary = await summariseAssessment(detail({ status: 'queued', result: null }));

    expect(summary).toMatchObject({ ready: false, early: null });
  });
});

describe('readAssessmentSummary', () => {
  it('reads the workspace’s assessment, then summarises it', async () => {
    mocks.getAssessment.mockResolvedValue(detail({ status: 'queued', result: null }));

    const summary = await readAssessmentSummary('a 1');

    expect(mocks.getAssessment).toHaveBeenCalledWith('a 1');
    expect(summary).toMatchObject({ id: 'a 1', status: 'queued' });
  });
});
