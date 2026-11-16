/**
 * Runs the calibration set against a framework version and stores the run (t-37).
 *
 *   npm run calibrate -- --mode quick --version 0.5.1
 *   npm run calibrate -- --mode ai --version 0.5.1
 *
 * `ai` calls every judge on every case in the install org, against its budget.
 * Exit 0 done, 1 refused, 2 bad usage. The logic is `runCalibrate` in
 * lib/app/calibration/cli.ts; this file only wires it up. See
 * .context/app/calibration.md.
 */
import { readFileSync } from 'node:fs';
import { runJudges } from '@/lib/app/assessments/fan-out';
import { runCalibrate } from '@/lib/app/calibration/cli';
import { prismaCalibrationStore } from '@/lib/app/calibration/store';
import { prismaFrameworkRepo } from '@/lib/app/frameworks/repo';
import { prisma } from '@/lib/db/client';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { runAsOrg, runAsSystem } from '@/lib/tenancy/context';

runCalibrate(process.argv.slice(2), {
  repo: prismaFrameworkRepo,
  store: prismaCalibrationStore,
  runJudges,
  runAsInstallOrg: (fn) => runAsOrg(INSTALL_ORG_ID, fn),
  readFile: (path) => readFileSync(path, 'utf8'),
  runAsSystem,
  // A command's own output, for the person who ran it.
  out: (line) => console.log(line),
})
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(2);
  });
