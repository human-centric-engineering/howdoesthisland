/**
 * What `/compare/[id]` reads of a comparison (t-89).
 *
 * Proved: the test fixture is what the API sends (the registry's wire
 * schema accepts it), and the page's own schema reads it; a comparison is
 * still moving while a draft runs or the verdict is to come, and not once
 * both have ended; a draft is called by its label, else its place.
 *
 * @see components/app/compare/schemas.ts
 */
import { describe, expect, it } from 'vitest';
import { comparisonDetailSchema, comparisonSummarySchema } from '@/lib/app/api/registry';
import {
  comparisonListEndpoint,
  comparisonListSchema,
  comparisonsPagePath,
  comparisonSchema,
  draftName,
  isMoving,
  type Comparison,
} from '@/components/app/compare/schemas';
import {
  aComparison,
  aComparisonRow,
  aRunningComparison,
} from '@/tests/unit/components/app/compare/fixtures';

const read = (wire: unknown): Comparison => comparisonSchema.parse(wire);

describe('comparisonSchema', () => {
  it('reads what the API sends, as its wire contract describes it', () => {
    for (const wire of [aComparison(), aRunningComparison()]) {
      expect(comparisonDetailSchema.safeParse(wire).success).toBe(true);
      expect(comparisonSchema.safeParse(wire).success).toBe(true);
    }
  });

  it('reads a purged draft, which has no review and no scores', () => {
    const wire = aComparison();
    wire.drafts[2] = {
      ...wire.drafts[2],
      assessmentId: null,
      status: 'purged',
      overall: null,
      band: null,
      appeals: null,
    };
    expect(comparisonDetailSchema.safeParse(wire).success).toBe(true);
    expect(read(wire).drafts[2].status).toBe('purged');
  });
});

describe('isMoving', () => {
  it('is moving while a draft is queued or running', () => {
    expect(isMoving(read(aRunningComparison()))).toBe(true);
  });

  it('is moving while every draft has ended and the verdict is waiting or running', () => {
    for (const status of ['waiting', 'running'] as const) {
      const c = read(aComparison({ verdict: { ...aComparison().verdict, status, draft: null } }));
      expect(isMoving(c)).toBe(true);
    }
  });

  it('is still once every draft has ended and the verdict has too', () => {
    for (const status of ['completed', 'failed', 'skipped'] as const) {
      expect(isMoving(read(aComparison({ verdict: { ...aComparison().verdict, status } })))).toBe(
        false
      );
    }
  });
});

describe('draftName', () => {
  it('is the label, else the draft’s place counted from one', () => {
    expect(draftName({ label: 'Subject A', position: 0 })).toBe('Subject A');
    expect(draftName({ label: null, position: 1 })).toBe('Draft 2');
  });
});

describe('comparisonListSchema (t-90)', () => {
  it('reads what the list sends, as its wire contract describes it', () => {
    const rows = [
      aComparisonRow(),
      aComparisonRow({
        id: 'cmp-2',
        status: 'running',
        verdict: { status: 'waiting', draft: null },
      }),
    ];
    for (const row of rows) expect(comparisonSummarySchema.safeParse(row).success).toBe(true);
    const read = comparisonListSchema.parse(rows);
    expect(read.map((r) => r.id)).toEqual(['cmp-1', 'cmp-2']);
    expect(read[0].verdict).toEqual({ status: 'completed', draft: 1 });
  });

  it('refuses a row it cannot show', () => {
    expect(comparisonListSchema.safeParse([{ id: 'cmp-1' }]).success).toBe(false);
  });
});

describe('comparisonListEndpoint', () => {
  it('asks for a page of the newest, leaving the first page out', () => {
    expect(comparisonListEndpoint()).toBe('/api/v1/comparisons?limit=20');
    expect(comparisonListEndpoint(3)).toBe('/api/v1/comparisons?limit=20&page=3');
    expect(comparisonListEndpoint(1, 3)).toBe('/api/v1/comparisons?limit=3');
  });

  it('addresses /compare’s pages the same way', () => {
    expect(comparisonsPagePath(1)).toBe('/compare');
    expect(comparisonsPagePath(2)).toBe('/compare?page=2');
  });
});
