/**
 * Imports a framework model file as a draft version. Refuses a file with any
 * problem (unresolved reference, schema error, …) and lists every one.
 * Importing the same file again changes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/app/frameworks/import.ts howdoesthisland lib/app/frameworks/howdoesthisland/data/model-0.5.1.json
 *
 * Exit 0 done, 1 refused, 2 bad usage. The logic is `runImport` in
 * lib/app/frameworks/cli.ts; this file only wires it up. See
 * .context/app/frameworks.md.
 */
import { readFileSync } from 'node:fs';
import { runImport } from '@/lib/app/frameworks/cli';
import { prismaFrameworkRepo } from '@/lib/app/frameworks/repo';
import { prisma } from '@/lib/db/client';
import { runAsSystem } from '@/lib/tenancy/context';

runImport(process.argv.slice(2), {
  repo: prismaFrameworkRepo,
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
