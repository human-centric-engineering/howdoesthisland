/**
 * The import and publish commands (t-10): usage, output, exit codes, and that
 * both run in the system scope; and the agreement line a gated publish prints
 * (t-40).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { agreementChangeLine } from '@/lib/app/calibration/gate';
import { runImport, runPublish, type CliDeps } from '@/lib/app/frameworks/cli';
import type { PublishGate } from '@/lib/app/frameworks/store';
import { FakeFrameworkRepo, OPEN_GATE } from '@/tests/unit/lib/app/frameworks/fake-repo';

const FILE = 'lib/app/frameworks/howdoesthisland/data/model-0.5.1.json';
const OLD = 'tests/unit/lib/app/frameworks/fixtures/model-0.5.0.json';

let repo: FakeFrameworkRepo;
let lines: string[];
let deps: CliDeps & { gate: PublishGate };
const reasons: string[] = [];

beforeEach(() => {
  repo = new FakeFrameworkRepo();
  lines = [];
  reasons.length = 0;
  deps = {
    repo,
    gate: OPEN_GATE,
    readFile: (path) => readFileSync(path, 'utf8'),
    runAsSystem: (reason, fn) => {
      reasons.push(reason);
      return fn();
    },
    out: (line) => lines.push(line),
  };
});

describe('runImport()', () => {
  it('imports a model as a draft, in the system scope, and says what it did', async () => {
    expect(await runImport(['howdoesthisland', FILE], deps)).toBe(0);
    expect(reasons).toEqual(['framework import: howdoesthisland']);
    expect(lines).toEqual([
      expect.stringMatching(
        /^howdoesthisland 0\.5\.1: created \(draft, \d+ records, \d+ links, sha256 [0-9a-f]{64}\)$/
      ),
    ]);
    expect(repo.versions.size).toBe(1);
  });

  it('exits 1 and prints every problem when the model is refused', async () => {
    expect(await runImport(['howdoesthisland', OLD], deps)).toBe(1);
    expect(lines[0]).toContain('39 problem(s)');
    expect(lines[0]).toContain('st_choice_overload');
    expect(repo.versions.size).toBe(0);
  });

  it('exits 2 on bad usage or an unknown framework, without reading the file', async () => {
    const readFile = vi.fn();
    deps.readFile = readFile;
    expect(await runImport([], deps)).toBe(2);
    expect(await runImport(['howdoesthisland', FILE, 'extra'], deps)).toBe(2);
    expect(await runImport(['nope', FILE], deps)).toBe(2);
    expect(lines).toEqual([
      'Usage: import.ts <framework-slug> <model-file.json>',
      'Usage: import.ts <framework-slug> <model-file.json>',
      'Unknown framework "nope".',
    ]);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('lets an unexpected failure through rather than reporting it as a refusal', async () => {
    repo.findVersion = () => Promise.reject(new Error('database down'));
    await expect(runImport(['howdoesthisland', FILE], deps)).rejects.toThrow('database down');
  });
});

describe('runPublish()', () => {
  it('publishes a draft in the system scope, then reports a second publish as a no-op', async () => {
    await runImport(['howdoesthisland', FILE], deps);
    lines.length = 0;
    expect(await runPublish(['howdoesthisland', '0.5.1'], deps)).toBe(0);
    expect(await runPublish(['howdoesthisland', '0.5.1'], deps)).toBe(0);
    expect(lines).toEqual([
      'howdoesthisland 0.5.1: published',
      'howdoesthisland 0.5.1: already published',
    ]);
    expect(reasons).toContain('framework publish: howdoesthisland 0.5.1');
  });

  it('exits 1 for a version that does not exist', async () => {
    expect(await runPublish(['howdoesthisland', '9.9.9'], deps)).toBe(1);
    expect(lines).toEqual(['No howdoesthisland version 9.9.9 to publish.']);
  });

  it('exits 2 on bad usage', async () => {
    expect(await runPublish(['howdoesthisland'], deps)).toBe(2);
    expect(lines).toEqual(['Usage: publish.ts <framework-slug> <version>']);
  });
});

describe('runPublish() reports the agreement change (t-40)', () => {
  const RAW = readFileSync(FILE, 'utf8');
  /** The bundled model under another number, as `<n>.json`. */
  const file = (v: string) => RAW.replace('"version": "0.5.1"', `"version": "${v}"`);
  const snapshot = (agreement: number) => ({
    runId: `run-${agreement}`,
    ranAt: '2026-11-17T10:00:00.000Z',
    agreement,
    setVersion: '0.6.0',
    checks: 40,
    judgeModels: { appeal: ['claude-sonnet-5-5'] },
  });
  /** Lets 0.5.1 through with no snapshot, as the real gate does, and records `agreements[v]` for the rest. */
  const gateWith = (agreements: Record<string, number>): PublishGate => ({
    check: (v) =>
      Promise.resolve({
        ok: true,
        calibration: v.version in agreements ? snapshot(agreements[v.version]) : null,
      }),
  });

  beforeEach(async () => {
    deps.readFile = (path) => (path === FILE ? RAW : file(path.replace('.json', '')));
    await runImport(['howdoesthisland', FILE], deps);
    await runImport(['howdoesthisland', '0.6.0.json'], deps);
    await runImport(['howdoesthisland', '0.7.0.json'], deps);
  });

  it('says so when no earlier published version has a snapshot (0.5.1 has none)', async () => {
    deps.gate = gateWith({ '0.6.0': 0.85 });
    await runPublish(['howdoesthisland', '0.5.1'], deps);
    lines.length = 0;
    expect(await runPublish(['howdoesthisland', '0.6.0'], deps)).toBe(0);
    expect(lines).toEqual([
      'howdoesthisland 0.6.0: published',
      'Agreement 85.0%. No earlier published version has a calibration snapshot.',
    ]);
  });

  it('prints the agreement, the last published snapshot’s, and the difference in points', async () => {
    deps.gate = gateWith({ '0.6.0': 0.85, '0.7.0': 0.825 });
    await runPublish(['howdoesthisland', '0.6.0'], deps);
    await runPublish(['howdoesthisland', '0.5.1'], deps);
    lines.length = 0;
    expect(await runPublish(['howdoesthisland', '0.7.0'], deps)).toBe(0);
    // 0.5.1 was published after 0.6.0 but has no snapshot, so 0.6.0 is the comparison.
    expect(lines).toEqual([
      'howdoesthisland 0.7.0: published',
      'Agreement 82.5%, against 85.0% for 0.6.0, the last published version with a snapshot: -2.5 pts.',
    ]);
  });

  it('signs a rise and prints no change as 0.0', async () => {
    deps.gate = gateWith({ '0.6.0': 0.8, '0.7.0': 0.8504 });
    await runPublish(['howdoesthisland', '0.6.0'], deps);
    lines.length = 0;
    await runPublish(['howdoesthisland', '0.7.0'], deps);
    expect(lines[1]).toMatch(/: \+5\.0 pts\.$/);

    expect(
      agreementChangeLine(snapshot(0.8), { version: '0.6.0', calibration: snapshot(0.80004) })
    ).toMatch(/: 0\.0 pts\.$/);
  });

  it('prints the difference of the two printed figures, not of the unrounded ones', () => {
    // Unrounded: 0.8144 - 0.8056 = 0.88 pts, which would print +0.9 under 81.4% and 80.6%.
    expect(
      agreementChangeLine(snapshot(0.8144), { version: '0.6.0', calibration: snapshot(0.8056) })
    ).toBe(
      'Agreement 81.4%, against 80.6% for 0.6.0, the last published version with a snapshot: +0.8 pts.'
    );
  });

  it('says when the two were measured on a different set or by different judges', () => {
    const before = {
      ...snapshot(0.85),
      setVersion: '0.5.1',
      judgeModels: { appeal: ['claude-opus-5-5'] },
    };
    expect(agreementChangeLine(snapshot(0.825), { version: '0.6.0', calibration: before })).toBe(
      'Agreement 82.5%, against 85.0% for 0.6.0, the last published version with a snapshot: ' +
        '-2.5 pts (not like for like: calibration set 0.5.1 then, 0.6.0 now; different judge models).'
    );
    // The same models listed in another order are the same judges.
    const now = { ...snapshot(0.825), judgeModels: { appeal: ['b', 'a'], fit: ['c'] } };
    const then = { ...snapshot(0.85), judgeModels: { fit: ['c'], appeal: ['a', 'b'] } };
    expect(agreementChangeLine(now, { version: '0.6.0', calibration: then })).toMatch(
      /-2\.5 pts\.$/
    );
  });

  it('publishes when the last snapshot cannot be read, and says there is no comparison', async () => {
    deps.gate = gateWith({ '0.7.0': 0.825 });
    repo.lastPublishedCalibration = () => Promise.reject(new Error('connection reset'));
    lines.length = 0;
    expect(await runPublish(['howdoesthisland', '0.7.0'], deps)).toBe(0);
    expect(lines).toEqual([
      'howdoesthisland 0.7.0: published',
      'Agreement 82.5%. The last published snapshot could not be read, so there is no comparison.',
    ]);
    expect([...repo.versions.values()].find((v) => v.version === '0.7.0')?.status).toBe(
      'PUBLISHED'
    );
  });

  it('rounds a stored half-tenth up, as four-place agreements often are', () => {
    // 0.5005 * 1000 is 500.4999… in floating point.
    expect(
      agreementChangeLine(snapshot(0.5005), { version: '0.6.0', calibration: snapshot(0.5) })
    ).toMatch(/^Agreement 50\.1%, against 50\.0% .*: \+0\.1 pts\.$/);
  });

  it('says when the two scored a different number of checks', () => {
    const before = { ...snapshot(0.85), checks: 48 };
    expect(agreementChangeLine(snapshot(0.825), { version: '0.6.0', calibration: before })).toMatch(
      /-2\.5 pts \(not like for like: 48 checks then, 40 now\)\.$/
    );
  });

  it('reports an unreadable stored snapshot, and publishes anyway', async () => {
    deps.gate = gateWith({ '0.6.0': 0.85, '0.7.0': 0.825 });
    await runPublish(['howdoesthisland', '0.6.0'], deps);
    const v060 = [...repo.versions.values()].find((v) => v.version === '0.6.0');
    if (!v060) throw new Error('0.6.0 not imported');
    v060.calibration = { agreement: 'high' };
    lines.length = 0;
    expect(await runPublish(['howdoesthisland', '0.7.0'], deps)).toBe(0);
    expect(lines).toEqual([
      'howdoesthisland 0.7.0: published',
      'Agreement 82.5%. The snapshot of 0.6.0, the last published version with one, is unreadable.',
    ]);
    expect([...repo.versions.values()].find((v) => v.version === '0.7.0')?.status).toBe(
      'PUBLISHED'
    );
  });

  it('prints no agreement for a no-op publish', async () => {
    deps.gate = gateWith({ '0.6.0': 0.85 });
    await runPublish(['howdoesthisland', '0.6.0'], deps);
    lines.length = 0;
    await runPublish(['howdoesthisland', '0.6.0'], deps);
    expect(lines).toEqual(['howdoesthisland 0.6.0: already published']);
  });
});
