/**
 * Tests: the print page's report source (t-31) — the services the API routes
 * answer from, with each answer in its wire shape.
 *
 * @see lib/app/reports/pdf/print-source.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '@/lib/api/errors';

const s = vi.hoisted(() => ({
  getAssessment: vi.fn(),
  resolveVersion: vi.fn(),
  versionDocument: vi.fn(),
}));
vi.mock('@/lib/app/assessments/api/service', () => ({ getAssessment: s.getAssessment }));
vi.mock('@/lib/app/frameworks/api/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/frameworks/api/service')>()),
  resolveVersion: s.resolveVersion,
  versionDocument: s.versionDocument,
}));

import { printReportSource } from '@/lib/app/reports/pdf/print-source';
import { FrameworkApiError } from '@/lib/app/frameworks/api/service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('printReportSource.assessment', () => {
  it('answers what the API would send: dates as ISO strings, undefined fields dropped', async () => {
    s.getAssessment.mockResolvedValue({
      id: 'asm_1',
      createdAt: new Date('2026-11-15T10:00:00.000Z'),
      completedAt: null,
      note: undefined,
    });
    expect(await printReportSource.assessment('asm_1')).toEqual({
      id: 'asm_1',
      createdAt: '2026-11-15T10:00:00.000Z',
      completedAt: null,
    });
    expect(s.getAssessment).toHaveBeenCalledWith('asm_1');
  });

  it('lets not-found through, for the page to answer', async () => {
    s.getAssessment.mockRejectedValue(new NotFoundError('Assessment not found'));
    await expect(printReportSource.assessment('asm_1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('printReportSource.model', () => {
  it("answers the version document's data, as the version route sends it", async () => {
    const resolved = { version: { id: 'v1' } };
    s.resolveVersion.mockResolvedValue(resolved);
    s.versionDocument.mockResolvedValue({ data: { dimensions: [{ id: 'd1' }] }, meta: {} });

    expect(await printReportSource.model('howdoesthisland', '0.5.1')).toEqual({
      dimensions: [{ id: 'd1' }],
    });
    expect(s.resolveVersion).toHaveBeenCalledWith('howdoesthisland', '0.5.1');
    expect(s.versionDocument).toHaveBeenCalledWith(resolved);
  });

  it('answers null for a version that is not found, as the API source does for a 404', async () => {
    s.resolveVersion.mockRejectedValue(
      new FrameworkApiError('FRAMEWORK_VERSION_NOT_FOUND', 'gone')
    );
    expect(await printReportSource.model('howdoesthisland', '0.4.0')).toBeNull();
  });

  it('lets any other failure through', async () => {
    s.resolveVersion.mockRejectedValue(new Error('database down'));
    await expect(printReportSource.model('howdoesthisland', '0.5.1')).rejects.toThrow(
      'database down'
    );
  });
});
