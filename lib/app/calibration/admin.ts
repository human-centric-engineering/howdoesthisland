/**
 * Calibration for the admin page (t-38): what `/admin/frameworks` shows, and
 * starting a run from it.
 *
 * **What it lists.** Every version of the framework, drafts included (a draft
 * is what a run is for), newest first, each with its stored calibration
 * snapshot and its runs. Each complete run carries its change from the run
 * before it of the same mode, against any version, as the CLI prints it
 * (`compare.ts`); the runs are each version's newest `LIST_LIMIT`, so the
 * oldest listed may compare with nothing although an older run exists.
 *
 * **Running, and stopped.** A run is stored `RUNNING` when it starts and
 * finishes in the background, beating while it runs. A `RUNNING` run whose
 * beat is older than `STOPPED_AFTER_MS` is shown as `stopped`: the process
 * running it went away (a deploy, or a serverless host's time limit) and it
 * will never finish. Nothing rewrites it; it simply stops counting as
 * running, so it no longer blocks another AI run of the version (store.ts).
 *
 * **Starting one.** A quick run is free and takes well under a second, so it
 * is waited for and returned complete. An AI run calls every judge on every
 * case (26 × 9) against the install org's budget, and returns as soon as it
 * is stored: it carries on with `keepRunningAfterResponse`, as an assessment
 * does. One AI run of a version at a time, which the store enforces. The admin who starts it is
 * `startedByUserId`, on the run and on each judge call's cost row.
 *
 * Publishing stays the CLI's (`scripts/app/frameworks/publish.ts`); this never
 * publishes.
 */
import { APIError, NotFoundError } from '@/lib/api/errors';
import { keepRunningAfterResponse } from '@/lib/api/after-response';
import { runJudges } from '@/lib/app/assessments/fan-out';
import { compareRuns, type RunComparison } from '@/lib/app/calibration/compare';
import type { CalibrationSnapshot } from '@/lib/app/calibration/gate';
import {
  CalibrationError,
  startCalibration,
  type CalibrationMode,
  type RunCalibrationDeps,
} from '@/lib/app/calibration/run';
import { BUNDLED_SET_VERSIONS, loadBundledSet } from '@/lib/app/calibration/sets';
import { calibrationSnapshotSchema } from '@/lib/app/calibration/wire';
import {
  CalibrationRunningError,
  hasStopped,
  prismaCalibrationStore,
  type CalibrationRunLister,
  type CalibrationStore,
  type ListedRun,
} from '@/lib/app/calibration/store';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import { prismaFrameworkRepo, type FrameworkRepo } from '@/lib/app/frameworks/repo';
import { materialise } from '@/lib/app/frameworks/store';
import { prisma } from '@/lib/db/client';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { runAsOrg, runAsSystem } from '@/lib/tenancy/context';
import type { z } from 'zod';

export type AdminRunStatus = 'running' | 'complete' | 'failed' | 'stopped';

export interface AdminRun extends Omit<ListedRun, 'status' | 'startedByUserId' | 'heartbeatAt'> {
  status: AdminRunStatus;
  /** Who started it, or null for the CLI (or a user since deleted). */
  startedBy: { id: string; name: string } | null;
  /** The run was of the version's file as imported now. */
  ofCurrentFile: boolean;
  /** The change from the run before it of the same mode; null for the first, or until complete. */
  comparison: RunComparison | null;
}

export interface AdminVersion {
  id: string;
  version: string;
  status: 'draft' | 'published' | 'retired';
  sourceSha256: string;
  createdAt: Date;
  publishedAt: Date | null;
  /** What was copied in at publish (`gate.ts`); null for a draft, or a version published before the gate. */
  calibration: CalibrationSnapshot | null;
  /** A calibration set is written for this version and it is not retired, so it can be run from the page. */
  runnable: boolean;
  /** Newest first. */
  runs: AdminRun[];
}

export interface FrameworkCalibration {
  slug: string;
  name: string;
  /** Newest first. */
  versions: AdminVersion[];
}

const snapshotSchema = calibrationSnapshotSchema satisfies z.ZodType<CalibrationSnapshot>;

const VERSION_STATUS = { DRAFT: 'draft', PUBLISHED: 'published', RETIRED: 'retired' } as const;

export interface CalibrationAdminDeps {
  store: CalibrationStore & CalibrationRunLister;
  repo: FrameworkRepo;
  runJudges: RunCalibrationDeps['runJudges'];
  now: () => Date;
}

const defaultDeps: CalibrationAdminDeps = {
  store: prismaCalibrationStore,
  repo: prismaFrameworkRepo,
  runJudges,
  now: () => new Date(),
};

function statusOf(run: Pick<ListedRun, 'status' | 'heartbeatAt'>, now: Date): AdminRunStatus {
  if (run.status !== 'running') return run.status;
  return hasStopped(run.heartbeatAt, now) ? 'stopped' : 'running';
}

/** Each complete run's comparison with the complete run of its mode before it. */
function comparisons(runs: readonly ListedRun[]): Map<string, RunComparison | null> {
  const out = new Map<string, RunComparison | null>();
  const oldestFirst = [...runs].reverse();
  const last: Partial<Record<CalibrationMode, ListedRun>> = {};
  for (const run of oldestFirst) {
    if (run.status !== 'complete' || !run.totals || !run.rows) continue;
    const previous = last[run.mode];
    out.set(
      run.id,
      previous?.totals && previous.rows
        ? compareRuns(
            {
              id: previous.id,
              createdAt: previous.createdAt,
              finishedAt: previous.finishedAt,
              frameworkVersion: previous.frameworkVersion,
              totals: previous.totals,
              rows: previous.rows,
            },
            { totals: run.totals, rows: run.rows }
          )
        : null
    );
    last[run.mode] = run;
  }
  return out;
}

/** The framework's versions and their calibration runs, for the admin page. */
export async function listFrameworkCalibration(
  deps: CalibrationAdminDeps = defaultDeps
): Promise<FrameworkCalibration> {
  const slug = howDoesThisLand.slug;
  const now = deps.now();
  const [framework, runs, starters] = await runAsSystem('calibration admin: list', async () => {
    const [framework, runs] = await Promise.all([
      prisma.framework.findUnique({
        where: { slug },
        select: {
          name: true,
          versions: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              version: true,
              status: true,
              sourceSha256: true,
              createdAt: true,
              publishedAt: true,
              calibration: true,
            },
          },
        },
      }),
      deps.store.listRuns(slug),
    ]);
    // One query for every starter's name, not one per run.
    const starterIds = [
      ...new Set(runs.flatMap((r) => (r.startedByUserId ? [r.startedByUserId] : []))),
    ];
    const starters = starterIds.length
      ? await prisma.user.findMany({
          where: { id: { in: starterIds } },
          select: { id: true, name: true },
        })
      : [];
    return [framework, runs, starters] as const;
  });
  const nameOf = new Map(starters.map((u) => [u.id, u.name]));
  const compared = comparisons(runs);

  const versions = (framework?.versions ?? []).map((v): AdminVersion => {
    const snapshot = snapshotSchema.safeParse(v.calibration);
    return {
      id: v.id,
      version: v.version,
      status: VERSION_STATUS[v.status],
      sourceSha256: v.sourceSha256,
      createdAt: v.createdAt,
      publishedAt: v.publishedAt,
      calibration: snapshot.success ? snapshot.data : null,
      runnable: v.status !== 'RETIRED' && BUNDLED_SET_VERSIONS.includes(v.version),
      runs: runs
        .filter((r) => r.frameworkVersionId === v.id)
        .map(({ startedByUserId, heartbeatAt, ...r }) => ({
          ...r,
          status: statusOf({ status: r.status, heartbeatAt }, now),
          startedBy:
            startedByUserId && nameOf.has(startedByUserId)
              ? { id: startedByUserId, name: nameOf.get(startedByUserId) ?? '' }
              : null,
          ofCurrentFile: r.sourceSha256 === v.sourceSha256,
          comparison: compared.get(r.id) ?? null,
        })),
    };
  });
  return { slug, name: framework?.name ?? howDoesThisLand.name, versions };
}

export interface StartedRun {
  runId: string;
  /** `complete` for a quick run, which is waited for; `running` for an AI run. */
  status: 'running' | 'complete';
}

/**
 * Starts a run of `version` in `mode`, recorded as started by `userId`.
 *
 * Errors: 404 `NOT_FOUND` (no such version); 409 `CALIBRATION_SET_MISSING`
 * (no set is written for it), `CALIBRATION_REFUSED` (the version is retired,
 * the set does not fit it, or it has no judges for an AI run), `CALIBRATION_RUNNING` (an AI
 * run of it is still running).
 */
export async function startCalibrationRun(
  input: { version: string; mode: CalibrationMode; userId: string },
  deps: CalibrationAdminDeps = defaultDeps
): Promise<StartedRun> {
  const slug = howDoesThisLand.slug;
  const found = await runAsSystem(`calibration admin: read ${slug} ${input.version}`, async () => {
    const v = await deps.repo.findVersion(slug, input.version);
    return v ? { v, model: await materialise(deps.repo, howDoesThisLand, v.id) } : null;
  });
  if (!found) throw new NotFoundError(`No ${slug} version ${input.version}.`);

  const set = await loadBundledSet(input.version);
  if (!set) {
    throw new APIError(
      `No calibration set is written for ${input.version}.`,
      'CALIBRATION_SET_MISSING',
      409
    );
  }

  try {
    const started = await startCalibration(
      {
        version: found.v,
        model: found.model,
        set,
        mode: input.mode,
        startedByUserId: input.userId,
      },
      {
        store: deps.store,
        runJudges: deps.runJudges,
        runAsInstallOrg: (fn) => runAsOrg(INSTALL_ORG_ID, fn),
      }
    );
    if (input.mode === 'quick') {
      // Inside the try, so a quick run's refusal is answered as one too.
      await started.done;
      return { runId: started.runId, status: 'complete' };
    }
    keepRunningAfterResponse(started.done, 'app: calibration run', { runId: started.runId });
    return { runId: started.runId, status: 'running' };
  } catch (err) {
    if (err instanceof CalibrationRunningError) {
      throw new APIError(
        `An AI run of ${input.version} is still running.`,
        'CALIBRATION_RUNNING',
        409,
        { runId: err.runId }
      );
    }
    if (err instanceof CalibrationError) {
      throw new APIError(err.message, 'CALIBRATION_REFUSED', 409, {
        reason: err.code,
        problems: [...err.problems],
      });
    }
    throw err;
  }
}
