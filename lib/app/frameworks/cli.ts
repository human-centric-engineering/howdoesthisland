/**
 * The import and publish commands (t-10), behind
 * `scripts/app/frameworks/import.ts` and `publish.ts`, which only wire them
 * to the real file system, database and process.
 *
 * Both write shared config, so they run in the system scope: at `multi`, a
 * write from inside a customer's workspace cannot change it
 * (`canChangeSharedSettings()`).
 */
import { agreementChangeLine } from '@/lib/app/calibration/gate';
import { logger } from '@/lib/logging';
import { getFrameworkDefinition } from '@/lib/app/frameworks/registry';
import type { FrameworkRepo } from '@/lib/app/frameworks/repo';
import {
  FrameworkStoreError,
  importVersion,
  publishVersion,
  type PublishGate,
} from '@/lib/app/frameworks/store';

export interface CliDeps {
  repo: FrameworkRepo;
  readFile: (path: string) => string;
  runAsSystem: <T>(reason: string, fn: () => Promise<T>) => Promise<T>;
  out: (line: string) => void;
}

/** Exit codes: 0 done, 1 refused (the problems are printed), 2 bad usage. */
export type ExitCode = 0 | 1 | 2;

function refused(err: unknown, out: (line: string) => void): ExitCode {
  if (err instanceof FrameworkStoreError) {
    out(err.message);
    return 1;
  }
  throw err;
}

/** `import <slug> <file>` */
export async function runImport(args: readonly string[], deps: CliDeps): Promise<ExitCode> {
  const [slug, file] = args;
  if (!slug || !file || args.length !== 2) {
    deps.out('Usage: import.ts <framework-slug> <model-file.json>');
    return 2;
  }
  const def = getFrameworkDefinition(slug);
  if (!def) {
    deps.out(`Unknown framework "${slug}".`);
    return 2;
  }
  const raw = deps.readFile(file);
  try {
    const result = await deps.runAsSystem(`framework import: ${slug}`, () =>
      importVersion(deps.repo, def, raw)
    );
    const v = result.version;
    deps.out(
      `${slug} ${v.version}: ${result.outcome} (${v.status.toLowerCase()}, ` +
        `${result.nodeCount} records, ${result.linkCount} links, sha256 ${v.sourceSha256})`
    );
    return 0;
  } catch (err) {
    return refused(err, deps.out);
  }
}

/**
 * `publish <slug> <version>`. A draft publishes only if `gate` allows it: the
 * calibration gate (`lib/app/calibration/gate.ts`, t-37). Publishing a gated
 * draft also prints its agreement against the last published snapshot's
 * (t-40), which only reports: it never refuses a publish.
 */
export async function runPublish(
  args: readonly string[],
  deps: CliDeps & { gate: PublishGate }
): Promise<ExitCode> {
  const [slug, version] = args;
  if (!slug || !version || args.length !== 2) {
    deps.out('Usage: publish.ts <framework-slug> <version>');
    return 2;
  }
  try {
    const { result, previous } = await deps.runAsSystem(
      `framework publish: ${slug} ${version}`,
      async () => {
        // Read before publishing, so this version is never its own comparison.
        // Only for the report line: a failed read must not stop the publish.
        const previous = await deps.repo.lastPublishedCalibration(slug).catch((err: unknown) => {
          logger.warn('Could not read the last published calibration snapshot', {
            slug,
            error: err instanceof Error ? err.message : String(err),
          });
          return 'unavailable' as const;
        });
        return { result: await publishVersion(deps.repo, slug, version, deps.gate), previous };
      }
    );
    deps.out(`${slug} ${version}: ${result.outcome.replace('_', ' ')}`);
    // Null on a no-op and on a version published before the gate: nothing to report.
    if (result.calibration) deps.out(agreementChangeLine(result.calibration, previous));
    return 0;
  } catch (err) {
    return refused(err, deps.out);
  }
}
