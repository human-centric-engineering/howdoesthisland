/**
 * The publish gate (t-37): a draft publishes only with an AI calibration run
 * of it, and the run's snapshot is copied into `FrameworkVersion.calibration`.
 *
 * The run must be of the draft as it is now: same version id, and the same
 * `sourceSha256`, since a draft re-imported after its run is other content.
 * It must also be whole: a run in which any judge failed scored part of the
 * set on the quick scan, which says nothing about the judges. The newest such
 * run is the one copied.
 *
 * **Versions published before the gate** ({@link UNGATED_VERSIONS}) are
 * exempt, per the planning ruling that the gate is not retroactive: a new
 * database (a developer's, a test's, a fresh environment) still publishes
 * them from a draft, as each was published originally, with no snapshot. A
 * version is never added to that list after the gate exists.
 */
import type { CalibrationStore } from '@/lib/app/calibration/store';
import type { PublishGate } from '@/lib/app/frameworks/store';
import type { StoredVersion } from '@/lib/app/frameworks/repo';

/** Published before the gate existed, by framework slug. Never added to. */
export const UNGATED_VERSIONS: Readonly<Record<string, readonly string[]>> = {
  howdoesthisland: ['0.5.1'],
};

/** What `FrameworkVersion.calibration` holds once a gated version is published. */
export interface CalibrationSnapshot {
  runId: string;
  ranAt: string;
  agreement: number;
  setVersion: string;
  checks: number;
  judgeModels: Record<string, string[]>;
}

/** AI runs of one version read when publishing; more than enough for any real history. */
const RUNS_READ = 50;

export function calibrationGate(store: Pick<CalibrationStore, 'aiRunsOf'>): PublishGate {
  return {
    async check(version: StoredVersion) {
      if (UNGATED_VERSIONS[version.frameworkSlug]?.includes(version.version)) {
        return { ok: true, calibration: null };
      }
      const runs = await store.aiRunsOf(version.id, RUNS_READ);
      const run = runs.find(
        (r) =>
          r.sourceSha256 === version.sourceSha256 &&
          r.totals.judgeFailures === 0 &&
          r.totals.checks > 0
      );
      if (!run) {
        const stale = runs.some((r) => r.sourceSha256 !== version.sourceSha256);
        const partial = runs.some((r) => r.sourceSha256 === version.sourceSha256);
        return {
          ok: false,
          reason:
            `${version.frameworkSlug} ${version.version} has no complete AI calibration run` +
            (partial
              ? ': every run of it had a judge fail.'
              : stale
                ? ' of the file as imported now: it was re-imported after its last run.'
                : '.') +
            ` Run \`npm run calibrate -- --mode ai --version ${version.version}\` first.`,
        };
      }
      const snapshot: CalibrationSnapshot = {
        runId: run.id,
        ranAt: run.createdAt.toISOString(),
        agreement: run.totals.agreement,
        setVersion: run.setVersion,
        checks: run.totals.checks,
        judgeModels: run.judgeModels,
      };
      return { ok: true, calibration: { ...snapshot } };
    },
  };
}
