/**
 * A comparison as an assistant reads it back (t-93): when it is ready, what
 * it keeps of the comparison's view, and what it leaves out.
 */
import { describe, expect, it } from 'vitest';
import type { ComparisonDetail } from '@/lib/app/comparisons/views';
import {
  comparisonSettled,
  compareUrlOf,
  summariseComparison,
} from '@/lib/app/mcp/comparison-summary';

const DETAIL: ComparisonDetail = {
  id: 'cmp 1',
  kind: 'comparison',
  status: 'partial',
  framework: { slug: 'howdoesthisland', version: '1.0.0' },
  profile: 'full',
  judges: ['ethos', 'logos'],
  projectId: null,
  project: null,
  createdAt: new Date('2026-11-26T10:00:00Z'),
  context: { audience: 'Jane Doe’s team' },
  drafts: [
    {
      position: 0,
      label: 'A',
      assessmentId: 'a-1',
      status: 'completed',
      overall: 70,
      band: 'Strong',
      appeals: [{ appeal: 'ethos', score: 7 }] as never,
    },
    {
      position: 1,
      label: null,
      assessmentId: null,
      status: 'purged',
      overall: null,
      band: null,
      appeals: null,
    },
  ],
  appeals: [{ appeal: 'ethos', leaders: [0], drafts: [{ position: 0, score: 7, delta: 0 }] }],
  verdict: {
    status: 'skipped',
    draft: null,
    why: null,
    appeals: [],
    reason: 'too_few_completed',
    model: 'secret-model',
    costUsd: 0.02,
    completedAt: null,
  },
};

describe('comparisonSettled', () => {
  it.each([
    ['running', 'waiting', false],
    ['completed', 'running', false],
    ['completed', 'waiting', false],
    ['completed', 'completed', true],
    ['partial', 'failed', true],
    ['failed', 'skipped', true],
    ['running', 'completed', false],
  ] as const)('a %s comparison with a %s verdict: %s', (status, verdict, settled) => {
    expect(comparisonSettled({ status, verdict: { status: verdict } })).toBe(settled);
  });
});

describe('summariseComparison', () => {
  const summary = summariseComparison(DETAIL);

  it('keeps each draft’s place, review, state and score, and the per-appeal leaders', () => {
    expect(summary).toMatchObject({
      id: 'cmp 1',
      status: 'partial',
      ready: true,
      next: null,
      drafts: [
        { position: 0, label: 'A', assessmentId: 'a-1', status: 'completed', overall: 70 },
        { position: 1, label: null, assessmentId: null, status: 'purged', overall: null },
      ],
      appeals: [{ appeal: 'ethos', leaders: [0], drafts: [{ position: 0, score: 7, delta: 0 }] }],
      verdict: { status: 'skipped', draft: null, reason: 'too_few_completed' },
    });
  });

  it('leaves out the context, the judges and the verdict’s model and cost', () => {
    const text = JSON.stringify(summary);
    expect(text).not.toMatch(/Jane|secret-model|costUsd|judges/);
    expect(summary.drafts[0]).not.toHaveProperty('appeals');
  });

  it('links to the comparison’s page, its id encoded', () => {
    expect(summary.compareUrl).toBe(compareUrlOf('cmp 1'));
    expect(summary.compareUrl).toMatch(/\/compare\/cmp%201$/);
  });

  it('says what to do next while it is not ready', () => {
    const running = summariseComparison({
      ...DETAIL,
      status: 'running',
      verdict: { ...DETAIL.verdict, status: 'waiting' },
    });
    expect(running.ready).toBe(false);
    expect(running.next).toContain('get_comparison');
  });
});
