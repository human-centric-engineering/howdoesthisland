/**
 * Tests: reading a finished review's gaps (t-108).
 *
 * Real: `buildGaps` and the worked example's report view it reads. Mocked:
 * `loadReport` (its own tests are `tests/unit/lib/app/reports/load.test.ts`),
 * Prisma, and the tenant context, so these check what the service adds: it
 * refuses an unfinished review, reads only the workspace's own rows, and
 * hands the latest finished rewrite and the brief to the gaps.
 *
 * @see lib/app/coaching/service.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadReport: vi.fn(),
  findFirst: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/app/reports/load', () => ({ loadReport: mocks.loadReport }));
vi.mock('@/lib/db/client', () => ({ prisma: { assessment: { findFirst: mocks.findFirst } } }));
vi.mock('@/lib/tenancy/context', () => ({ requireOrgId: () => 'org-a' }));
vi.mock('@/lib/logging', () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { APIError, NotFoundError } from '@/lib/api/errors';
import { getGaps } from '@/lib/app/coaching/service';
import { printReportSource } from '@/lib/app/reports/pdf/print-source';
import { gapsSchema } from '@/lib/app/coaching/wire';
import { DRAFT_VIEW, MODEL } from '@/tests/unit/lib/app/coaching/example-view';

const ready = { kind: 'ready', view: DRAFT_VIEW, model: MODEL, projectId: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadReport.mockResolvedValue(ready);
  mocks.findFirst.mockResolvedValue({ project: null, rewrites: [] });
});

describe('getGaps', () => {
  it('reads the report through the services the API answers from, and the rows in this workspace only', async () => {
    const answer = await getGaps('a-1');
    expect(mocks.loadReport).toHaveBeenCalledWith('a-1', printReportSource);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a-1', orgId: 'org-a' } })
    );
    expect(gapsSchema.parse(answer)).toEqual(answer);
    expect(answer.assessmentId).toBe('a-1');
    expect(answer.gaps.map((g) => g.id)).toContain('customer-proof');
  });

  it.each([
    ['still running', { kind: 'pending', assessment: {} }],
    ['ended with no result', { kind: 'no_result', assessment: {} }],
  ])('refuses a review %s with 409 ASSESSMENT_NOT_FINISHED', async (_, load) => {
    mocks.loadReport.mockResolvedValue(load);
    const err = await getGaps('a-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIError);
    expect(err).toMatchObject({ code: 'ASSESSMENT_NOT_FINISHED', status: 409 });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('passes on a review not in this workspace as not found', async () => {
    mocks.loadReport.mockRejectedValue(new NotFoundError('Assessment not found'));
    await expect(getGaps('elsewhere')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('is not found when the review goes between the two reads', async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(getGaps('a-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws on a report it cannot read, rather than answering no gaps', async () => {
    mocks.loadReport.mockResolvedValue({ kind: 'unreadable' });
    await expect(getGaps('a-1')).rejects.toThrow('could not be read');
  });

  it('asks only the rewrite that finished last for its placeholders', async () => {
    mocks.findFirst.mockResolvedValue({
      project: null,
      rewrites: [{ id: 'rw-9', draft: 'Hi [ADD: a customer like Sarah’s].' }],
    });
    const { gaps } = await getGaps('a-1');
    expect(gaps[0]).toMatchObject({
      id: 'placeholder-rw-9-p1',
      missing: 'a customer like Sarah’s',
      sources: [{ kind: 'placeholder', rewriteId: 'rw-9', placeholderId: 'p1' }],
    });
    expect(mocks.findFirst.mock.calls[0][0].select.rewrites).toEqual({
      where: { status: 'COMPLETED' },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
      take: 1,
      select: { id: true, draft: true },
    });
  });

  it('drops what the project’s brief answers, and asks for what it leaves empty', async () => {
    mocks.findFirst.mockResolvedValue({
      project: { brief: { offer: 'Stock systems', audience: 'Ops directors' } },
      rewrites: [],
    });
    const ids = (await getGaps('a-1')).gaps.map((g) => g.id);
    expect(ids).not.toContain('brief-offer');
    expect(ids).not.toContain('reader');
    expect(ids.slice(-3)).toEqual(['brief-voice', 'brief-markets', 'brief-goals']);
  });

  it('reads an unreadable brief as none, and says so', async () => {
    mocks.findFirst.mockResolvedValue({ project: { brief: { offer: 42 } }, rewrites: [] });
    const ids = (await getGaps('a-1')).gaps.map((g) => g.id);
    expect(ids.some((id) => id.startsWith('brief-'))).toBe(false);
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('brief unreadable'), {
      assessmentId: 'a-1',
    });
  });
});
