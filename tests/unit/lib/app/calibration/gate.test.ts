/**
 * The publish gate (t-37), alone and through the store's `publishVersion`:
 * a draft with no complete AI run of it, as imported now, is refused; one
 * with such a run publishes and records its snapshot; the versions published
 * before the gate are exempt.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calibrationGate, UNGATED_VERSIONS } from '@/lib/app/calibration/gate';
import { tally } from '@/lib/app/calibration/score';
import type { StoredRun } from '@/lib/app/calibration/store';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import type { StoredVersion } from '@/lib/app/frameworks/repo';
import { FrameworkStoreError, importVersion, publishVersion } from '@/lib/app/frameworks/store';
import { FakeFrameworkRepo } from '@/tests/unit/lib/app/frameworks/fake-repo';

const DRAFT: StoredVersion = {
  id: 'ver-2',
  frameworkSlug: 'howdoesthisland',
  version: '0.6.0',
  schemaVersion: '1',
  status: 'DRAFT',
  sourceSha256: 'sha-now',
  publishedAt: null,
};

function aiRun(over: Partial<StoredRun> & { failures?: number } = {}): StoredRun {
  const { failures = 0, ...rest } = over;
  const rows = [
    {
      case: 'ev01',
      checks: [
        { kind: 'appeal' as const, key: 'ethos', expected: 'low', got: 10, result: 'ok' as const },
        {
          kind: 'appeal' as const,
          key: 'pathos',
          expected: 'low',
          got: 90,
          result: 'miss' as const,
        },
      ],
      judgeFailures: [],
    },
  ];
  return {
    id: 'run-1',
    frameworkVersionId: DRAFT.id,
    frameworkVersion: DRAFT.version,
    sourceSha256: 'sha-now',
    setVersion: '0.6.0',
    mode: 'ai',
    judgeModels: { judge_ethos: ['openai/gpt-x'] },
    totals: tally(rows, failures),
    rows,
    costUsd: 1.2,
    createdAt: new Date('2026-11-16T12:00:00Z'),
    ...rest,
  };
}

const gateOver = (runs: StoredRun[]) => {
  const aiRunsOf = vi.fn(async () => runs);
  return { gate: calibrationGate({ aiRunsOf }), aiRunsOf };
};

describe('calibrationGate()', () => {
  it('refuses a draft with no AI run, and names the command to run', async () => {
    const { gate, aiRunsOf } = gateOver([]);
    const out = await gate.check(DRAFT);
    expect(out).toEqual({
      ok: false,
      reason:
        'howdoesthisland 0.6.0 has no complete AI calibration run. ' +
        'Run `npm run calibrate -- --mode ai --version 0.6.0` first.',
    });
    expect(aiRunsOf).toHaveBeenCalledWith('ver-2', expect.any(Number));
  });

  it('refuses a draft whose only runs had a judge fail', async () => {
    const { gate } = gateOver([aiRun({ failures: 1 })]);
    const out = await gate.check(DRAFT);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toContain('every run of it had a judge fail');
  });

  it('refuses a draft re-imported since its run', async () => {
    const { gate } = gateOver([aiRun({ sourceSha256: 'sha-before' })]);
    const out = await gate.check(DRAFT);
    expect(!out.ok && out.reason).toContain('re-imported after its last run');
  });

  it('allows the newest complete run of the draft as it is, with its snapshot', async () => {
    const { gate } = gateOver([
      aiRun({ id: 'run-3', failures: 2 }),
      aiRun({ id: 'run-2' }),
      aiRun({ id: 'run-1', createdAt: new Date('2026-11-01T00:00:00Z') }),
    ]);
    expect(await gate.check(DRAFT)).toEqual({
      ok: true,
      calibration: {
        runId: 'run-2',
        ranAt: '2026-11-16T12:00:00.000Z',
        agreement: 0.5,
        setVersion: '0.6.0',
        checks: 2,
        judgeModels: { judge_ethos: ['openai/gpt-x'] },
      },
    });
  });

  it('lets the versions published before the gate through without a run', async () => {
    expect(UNGATED_VERSIONS).toEqual({ howdoesthisland: ['0.5.1'] });
    const { gate, aiRunsOf } = gateOver([]);
    expect(await gate.check({ ...DRAFT, version: '0.5.1' })).toEqual({
      ok: true,
      calibration: null,
    });
    expect(aiRunsOf).not.toHaveBeenCalled();
  });
});

describe('publishVersion() through the calibration gate', () => {
  const RAW = readFileSync('lib/app/frameworks/howdoesthisland/data/model-0.5.1.json', 'utf8');
  // The same model under a version the gate does not exempt.
  const RAW_060 = RAW.replace('"version": "0.5.1"', '"version": "0.6.0"');
  let repo: FakeFrameworkRepo;

  beforeEach(() => {
    repo = new FakeFrameworkRepo();
  });

  it('refuses a draft with no AI run of it, and leaves it a draft', async () => {
    const { version } = await importVersion(repo, howDoesThisLand, RAW_060);
    expect(version.version).toBe('0.6.0');
    const { gate } = gateOver([]);
    const err: unknown = await publishVersion(repo, 'howdoesthisland', '0.6.0', gate).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(FrameworkStoreError);
    expect(err).toMatchObject({ code: 'VERSION_UNCALIBRATED' });
    expect(repo.versions.get(version.id)).toMatchObject({ status: 'DRAFT', calibration: null });
  });

  it('publishes a draft with a run of it, copying the snapshot into calibration', async () => {
    const { version } = await importVersion(repo, howDoesThisLand, RAW_060);
    const { gate } = gateOver([
      aiRun({ frameworkVersionId: version.id, sourceSha256: version.sourceSha256 }),
    ]);
    const out = await publishVersion(repo, 'howdoesthisland', '0.6.0', gate);
    expect(out.outcome).toBe('published');
    expect(repo.versions.get(version.id)).toMatchObject({
      status: 'PUBLISHED',
      calibration: { runId: 'run-1', agreement: 0.5, setVersion: '0.6.0' },
    });
  });
});
