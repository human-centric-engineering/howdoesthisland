/**
 * Tests: loading a report through the API (t-29).
 *
 * @see lib/app/reports/load.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ require: vi.fn(), load: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/api/server-load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/server-load')>()),
  requireServerData: m.require,
  loadServerData: m.load,
}));
vi.mock('@/lib/logging', () => ({
  logger: { error: m.error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { apiReportSource, assessmentPath, loadReport, modelPath } from '@/lib/app/reports/load';
import { apiAssessment, modelDocument } from '@/tests/unit/lib/app/reports/fixtures';

function answer(assessment: unknown, model: unknown = modelDocument(true)) {
  m.require.mockImplementation((path: string) => {
    if (path === assessmentPath('asm_1')) return Promise.resolve({ data: assessment, meta: null });
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
  m.load.mockImplementation((path: string) => {
    if (path === modelPath('howdoesthisland', '0.5.1'))
      return Promise.resolve({ ok: true, data: model, meta: null });
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

beforeEach(() => {
  m.require.mockReset();
  m.load.mockReset();
  m.error.mockReset();
});

describe('loadReport', () => {
  it('reads the assessment with notFound, then its model version, and builds the report', async () => {
    answer(apiAssessment());
    const load = await loadReport('asm_1', apiReportSource);
    expect(load.kind).toBe('ready');
    expect(m.require).toHaveBeenNthCalledWith(1, '/api/v1/assessments/asm_1', { notFound: true });
    // 404 is expected so the loader logs it once, with the assessment, rather than twice.
    expect(m.load).toHaveBeenCalledWith('/api/v1/frameworks/howdoesthisland/versions/0.5.1', {
      expected: [404],
    });
    if (load.kind === 'ready') expect(load.view.cover.title).toBe('Q3 board briefing');
  });

  it('is pending while the run is queued or running, without reading the model', async () => {
    for (const status of ['queued', 'running'] as const) {
      answer(apiAssessment({ status, result: null, completedAt: null }));
      expect((await loadReport('asm_1', apiReportSource)).kind).toBe('pending');
    }
    expect(m.require).toHaveBeenCalledTimes(2);
    expect(m.load).not.toHaveBeenCalled();
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
    m.load.mockResolvedValue({ ok: false, failure: { kind: 'not_found' } });
    expect((await loadReport('asm_1', apiReportSource)).kind).toBe('unreadable');
    expect(m.error).toHaveBeenCalledWith(
      'Report: the model version it ran on was not found',
      undefined,
      expect.objectContaining({ assessmentId: 'asm_1' })
    );
  });

  it('throws to the error boundary when the model read fails otherwise, so a retry can help', async () => {
    answer(apiAssessment());
    m.load.mockResolvedValue({ ok: false, failure: { kind: 'failed', status: 503, code: null } });
    await expect(loadReport('asm_1', apiReportSource)).rejects.toThrow(
      'Could not load /api/v1/frameworks/howdoesthisland/versions/0.5.1 (503)'
    );
  });

  it('encodes the id into the path', () => {
    expect(assessmentPath('a/b')).toBe('/api/v1/assessments/a%2Fb');
  });
});
