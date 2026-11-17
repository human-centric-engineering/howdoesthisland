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
import { agreementPct, agreementTenths } from '@/lib/app/calibration/score';
import { calibrationSnapshotSchema } from '@/lib/app/calibration/wire';
import type { PublishGate } from '@/lib/app/frameworks/store';
import type { StoredVersion } from '@/lib/app/frameworks/repo';

/**
 * Published before the gate existed: framework slug → version → the sha256 of
 * the file as published. Pinned to the file, so a different file imported
 * under the same number is gated like any other. Never added to.
 */
export const UNGATED_VERSIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  howdoesthisland: {
    '0.5.1': '6b4f0d80a0eaf60ccab2ab9b7a99b96d53d6d0f850fcbf3f98c1c797d187344e',
  },
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

export function calibrationGate(store: Pick<CalibrationStore, 'aiRunsOf'>): PublishGate {
  return {
    async check(version: StoredVersion) {
      if (UNGATED_VERSIONS[version.frameworkSlug]?.[version.version] === version.sourceSha256) {
        return { ok: true, calibration: null };
      }
      // Every AI run of the version: a version has few, and a cap could hide the one complete run.
      const runs = await store.aiRunsOf(version.id);
      const run = runs.find(
        (r) =>
          r.sourceSha256 === version.sourceSha256 &&
          r.totals.judgeFailures === 0 &&
          r.totals.checks > 0
      );
      if (!run) {
        const current = runs.filter((r) => r.sourceSha256 === version.sourceSha256);
        const why =
          current.length === 0
            ? runs.length > 0
              ? ' of the file as imported now: it was re-imported after its last run.'
              : '.'
            : current.some((r) => r.totals.judgeFailures > 0)
              ? ': every run of it had a judge fail or scored nothing.'
              : ': every run of it scored nothing.';
        return {
          ok: false,
          reason:
            `${version.frameworkSlug} ${version.version} has no complete AI calibration run${why}` +
            ` Run \`npm run calibrate -- --mode ai --version ${version.version}\` first.`,
        };
      }
      const snapshot: CalibrationSnapshot = {
        runId: run.id,
        // When it finished: since t-38 a run is stored when it starts.
        ranAt: (run.finishedAt ?? run.createdAt).toISOString(),
        agreement: run.totals.agreement,
        setVersion: run.setVersion,
        checks: run.totals.checks,
        judgeModels: run.judgeModels,
      };
      return { ok: true, calibration: { ...snapshot } };
    },
  };
}

/** Judge models as a comparable key: kinds and their models in a fixed order. */
const modelsKey = (m: Record<string, string[]>) =>
  JSON.stringify(
    Object.keys(m)
      .sort()
      .map((k) => [k, [...m[k]].sort()])
  );

/**
 * What `publish` prints after publishing a gated draft (t-40): its agreement
 * against the last published snapshot's, until an agreement floor exists.
 * `current` is the snapshot just recorded; `previous` is what
 * `FrameworkRepo.lastPublishedCalibration` read before the publish, or
 * `'unavailable'` when that read failed. Both are
 * parsed here, and one that does not parse is reported, never thrown: this
 * only reports, and the publish has already happened.
 */
export function agreementChangeLine(
  current: unknown,
  previous: { version: string; calibration: unknown } | null | 'unavailable'
): string {
  const now = calibrationSnapshotSchema.safeParse(current);
  if (!now.success) return 'Agreement: the snapshot just recorded is unreadable.';
  const head = `Agreement ${agreementPct(now.data.agreement)}`;
  if (previous === 'unavailable') {
    return `${head}. The last published snapshot could not be read, so there is no comparison.`;
  }
  if (!previous) return `${head}. No earlier published version has a calibration snapshot.`;
  const before = calibrationSnapshotSchema.safeParse(previous.calibration);
  if (!before.success) {
    return `${head}. The snapshot of ${previous.version}, the last published version with one, is unreadable.`;
  }
  // The difference of the two printed figures, signed as `calibrate` prints
  // a change between runs. A difference of integers: never -0.0.
  const pts = (agreementTenths(now.data.agreement) - agreementTenths(before.data.agreement)) / 10;
  // A different set, number of checks or judge is a different measure: say so.
  const unlike = [
    now.data.setVersion !== before.data.setVersion
      ? `calibration set ${before.data.setVersion} then, ${now.data.setVersion} now`
      : null,
    now.data.checks !== before.data.checks
      ? `${before.data.checks} checks then, ${now.data.checks} now`
      : null,
    modelsKey(now.data.judgeModels) !== modelsKey(before.data.judgeModels)
      ? 'different judge models'
      : null,
  ].filter((x): x is string => x !== null);
  return (
    `${head}, against ${agreementPct(before.data.agreement)} for ${previous.version}, the last published ` +
    `version with a snapshot: ${pts > 0 ? '+' : ''}${pts.toFixed(1)} pts` +
    (unlike.length ? ` (not like for like: ${unlike.join('; ')}).` : '.')
  );
}
