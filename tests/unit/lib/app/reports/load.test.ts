/**
 * Tests: loading a report (t-29): the assessment through the API, the model
 * in process (t-67), since the whole model is for platform admins only over HTTP.
 *
 * @see lib/app/reports/load.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ require: vi.fn(), model: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/api/server-load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/server-load')>()),
  requireServerData: m.require,
}));
vi.mock('@/lib/app/reports/pdf/print-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/reports/pdf/print-source')>()),
  loadModelDocument: m.model,
}));
vi.mock('@/lib/logging', () => ({
  logger: { error: m.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { apiReportSource, assessmentPath, loadReport } from '@/lib/app/reports/load';
import { apiAssessment, modelDocument } from '@/tests/unit/lib/app/reports/fixtures';

function answer(assessment: unknown, model: unknown = modelDocument(true)) {
  m.require.mockImplementation((path: string) => {
    if (path === assessmentPath('asm_1')) return Promise.resolve({ data: assessment, meta: null });
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
  m.model.mockImplementation((slug: string, version: string) => {
    if (slug === 'howdoesthisland' && version === '0.5.1') return Promise.resolve(model);
    return Promise.reject(new Error(`unexpected version ${slug}@${version}`));
  });
}

beforeEach(() => {
  m.require.mockReset();
  m.model.mockReset();
  m.error.mockReset();
});

describe('loadReport', () => {
  it('reads the assessment through the API, then its model version in process, and builds the report', async () => {
    answer(apiAssessment());
    const load = await loadReport('asm_1', apiReportSource);
    expect(load.kind).toBe('ready');
    expect(m.require).toHaveBeenCalledTimes(1);
    expect(m.require).toHaveBeenNthCalledWith(1, '/api/v1/assessments/asm_1', { notFound: true });
    expect(m.model).toHaveBeenCalledWith('howdoesthisland', '0.5.1');
    if (load.kind === 'ready') expect(load.view.cover.title).toBe('Q3 board briefing');
  });

  it('is pending while the run is queued or running, without reading the model', async () => {
    for (const status of ['queued', 'running'] as const) {
      answer(apiAssessment({ status, result: null, completedAt: null }));
      expect((await loadReport('asm_1', apiReportSource)).kind).toBe('pending');
    }
    expect(m.require).toHaveBeenCalledTimes(2);
    expect(m.model).not.toHaveBeenCalled();
  });

  it('reads a batch page not fetched yet as pending, and one that could not be read as having no result (t-101)', async () => {
    const page = { text: null, wordCount: null, result: null, completedAt: null };
    answer({ ...apiAssessment({ status: 'queued' }), ...page });
    expect((await loadReport('asm_1', apiReportSource)).kind).toBe('pending');

    answer({
      ...apiAssessment({ status: 'failed', errorCode: 'FETCH_FAILED', error: 'Not fetched.' }),
      ...page,
    });
    const load = await loadReport('asm_1', apiReportSource);
    expect(load.kind).toBe('no_result');
    if (load.kind === 'no_result') expect(load.assessment.errorCode).toBe('FETCH_FAILED');
    expect(m.error).not.toHaveBeenCalled();
  });

  it('is unreadable, and logs it, for a result that comes with no text', async () => {
    answer({ ...apiAssessment(), text: null, wordCount: null });
    expect((await loadReport('asm_1', apiReportSource)).kind).toBe('unreadable');
    expect(m.error).toHaveBeenCalledWith('Report: a result with no text', undefined, {
      assessmentId: 'asm_1',
    });
  });

  it('has no result when a final run stored none', async () => {
    answer(apiAssessment({ status: 'failed', result: null, error: 'Could not score.' }));
    expect((await loadReport('asm_1', apiReportSource)).kind).toBe('no_result');
  });

  it('is unreadable, and logs it, when the result does not parse', async () => {
    answer(apiAssessment({ result: { mode: 'full' } }));
    expect((await loadReport('asm_1', apiReportSource)).kind).toBe('unreadable');
    expect(m.error).toHaveBeenCalledWith(
      'Report: the result did not parse',
      undefined,
      expect.objectContaining({ assessmentId: 'asm_1' })
    );
  });

  it('is unreadable when the assessment itself does not parse', async () => {
    answer({ id: 'asm_1' });
    expect((await loadReport('asm_1', apiReportSource)).kind).toBe('unreadable');
    expect(m.error).toHaveBeenCalledWith(
      'Report: the assessment did not parse',
      undefined,
      expect.anything()
    );
  });

  it('is unreadable when the model does not parse', async () => {
    answer(apiAssessment(), { meta: {} });
    expect((await loadReport('asm_1', apiReportSource)).kind).toBe('unreadable');
    expect(m.error).toHaveBeenCalledWith(
      'Report: the model did not parse',
      undefined,
      expect.anything()
    );
  });

  it('is unreadable, and logs it, when the model version it ran on is not found', async () => {
    answer(apiAssessment());
    m.model.mockResolvedValue(null);
    expect((await loadReport('asm_1', apiReportSource)).kind).toBe('unreadable');
    expect(m.error).toHaveBeenCalledWith(
      'Report: the model version it ran on was not found',
      undefined,
      expect.objectContaining({ assessmentId: 'asm_1' })
    );
  });

  it('throws to the error boundary when the model read fails otherwise, so a retry can help', async () => {
    answer(apiAssessment());
    m.model.mockRejectedValue(new Error('database unavailable'));
    await expect(loadReport('asm_1', apiReportSource)).rejects.toThrow('database unavailable');
  });

  it('encodes the id into the path', () => {
    expect(assessmentPath('a/b')).toBe('/api/v1/assessments/a%2Fb');
  });
});
