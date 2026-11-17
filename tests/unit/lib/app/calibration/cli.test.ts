/**
 * The calibrate command (t-37): usage, what it refuses, what it prints, and
 * that it reads in the system scope and runs the judges in the install org.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runCalibrate, type CalibrateDeps } from '@/lib/app/calibration/cli';
import { CalibrationRunningError, type NewRun, type StoredRun } from '@/lib/app/calibration/store';
import { fakeCalibrationStore } from '@/tests/unit/lib/app/calibration/fake-store';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import { importVersion } from '@/lib/app/frameworks/store';
import { FakeFrameworkRepo } from '@/tests/unit/lib/app/frameworks/fake-repo';

const MODEL = 'lib/app/frameworks/howdoesthisland/data/model-0.5.1.json';

let repo: FakeFrameworkRepo;
let lines: string[];
let deps: CalibrateDeps;
let created: NewRun[];
let previous: StoredRun | null;

beforeEach(async () => {
  repo = new FakeFrameworkRepo();
  await importVersion(repo, howDoesThisLand, readFileSync(MODEL, 'utf8'));
  lines = [];
  previous = null;
  const fake = fakeCalibrationStore();
  fake.store.latestRun.mockImplementation(async () => previous);
  created = fake.created;
  const store = fake.store;
  deps = {
    repo,
    store,
    runJudges: vi.fn(),
    runAsInstallOrg: (fn) => fn(),
    readFile: (path) => readFileSync(path, 'utf8'),
    runAsSystem: (_reason, fn) => fn(),
    out: (line) => lines.push(line),
  };
});

describe('runCalibrate()', () => {
  it('runs the version’s own set in quick mode, stores it and prints its totals', async () => {
    expect(await runCalibrate(['--mode', 'quick', '--version', '0.5.1'], deps)).toBe(0);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ mode: 'quick', setVersion: '0.5.1' });
    expect(lines[0]).toMatch(/^howdoesthisland 0\.5\.1, quick run [0-9a-f-]{36} \(set 0\.5\.1\)$/);
    expect(lines[1]).toMatch(/^Agreement \d+\.\d% over \d+ checks in 26 cases$/);
    expect(lines).toContainEqual(
      expect.stringMatching(/^ {2}appeal {4}\d+ ok, \d+ near, \d+ miss of 104$/)
    );
    expect(lines.at(-1)).toBe('No earlier run of this mode to compare with.');
    expect(deps.runJudges).not.toHaveBeenCalled();
  });

  it('prints the change from the last run of the same mode', async () => {
    await runCalibrate(['--mode', 'quick', '--version', '0.5.1'], deps);
    const first = created[0];
    previous = {
      ...first,
      id: 'run-0',
      frameworkVersion: '0.5.0',
      createdAt: new Date('2026-11-15T00:00:00Z'),
    };
    lines = [];
    await runCalibrate(['--mode', 'quick', '--version', '0.5.1'], deps);
    expect(lines[1]).toMatch(/ \(0\.0 pts\)$/);
    expect(lines.at(-1)).toBe(
      'Compared with run run-0 (0.5.0, 2026-11-15T00:00:00.000Z): 0 check(s) changed.'
    );
  });

  it('exits 2 on bad usage', async () => {
    for (const args of [
      [],
      ['--mode', 'slow', '--version', '0.5.1'],
      ['--mode', 'quick'],
      ['--mode', 'quick', '--version'],
      ['--mode', 'quick', '--version', '0.5.1', '--mode', 'ai'],
      ['--mode', 'quick', '--version', '0.5.1', '--force', 'yes'],
      // No flag picks another set (see cli.ts).
      ['--mode', 'quick', '--version', '0.5.1', '--set', 'tiny.json'],
    ]) {
      expect(await runCalibrate(args, deps)).toBe(2);
    }
    expect(new Set(lines)).toEqual(
      new Set(['Usage: calibrate --mode quick|ai --version <version>'])
    );
  });

  it('exits 1 for a version not imported, or a set that is missing or not a set', async () => {
    expect(await runCalibrate(['--mode', 'quick', '--version', '9.9.9'], deps)).toBe(1);
    expect(lines.pop()).toBe('No howdoesthisland version 9.9.9. Import it first.');

    const args = ['--mode', 'quick', '--version', '0.5.1'];
    const EVAL = 'lib/app/frameworks/howdoesthisland/data/eval-0.5.1.json';
    deps.readFile = () => {
      throw new Error('ENOENT');
    };
    expect(await runCalibrate(args, deps)).toBe(1);
    expect(lines.pop()).toBe(`No calibration set at ${EVAL}.`);

    deps.readFile = () => '{';
    expect(await runCalibrate(args, deps)).toBe(1);
    expect(lines.pop()).toBe(`${EVAL} is not valid JSON.`);

    deps.readFile = () => '{"meta": {}}';
    expect(await runCalibrate(args, deps)).toBe(1);
    expect(lines).toContain(`${EVAL} is not a calibration set:`);
    expect(created).toHaveLength(0);
  });

  it('exits 1 with the runner’s reason when the set does not fit the version', async () => {
    const other = readFileSync(MODEL, 'utf8').replace('"version": "0.5.1"', '"version": "0.6.0"');
    await importVersion(repo, howDoesThisLand, other);
    // eval-0.6.0.json does not exist; stand the 0.5.1 set in for it.
    const real = deps.readFile;
    deps.readFile = (path) => real(path.replace('eval-0.6.0.json', 'eval-0.5.1.json'));
    const args = ['--mode', 'quick', '--version', '0.6.0'];
    expect(await runCalibrate(args, deps)).toBe(1);
    expect(lines.pop()).toBe('The calibration set is written for model 0.5.1, not 0.6.0.');
  });

  it('exits 1 when an AI run of the version is still running, spending nothing', async () => {
    deps.store.startRun = vi.fn(async () => {
      throw new CalibrationRunningError('cal-0');
    });
    expect(await runCalibrate(['--mode', 'ai', '--version', '0.5.1'], deps)).toBe(1);
    expect(lines.pop()).toBe('An AI run of this version is still running (cal-0).');
    expect(deps.runJudges).not.toHaveBeenCalled();
  });
});
