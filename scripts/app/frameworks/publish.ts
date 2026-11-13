/**
 * Publishes a draft framework version. After this it can never change.
 *
 *   npx tsx --env-file=.env.local scripts/app/frameworks/publish.ts howdoesthisland 0.5.1
 *
 * Exit 0 done, 1 refused, 2 bad usage. The logic is `runPublish` in
 * lib/app/frameworks/cli.ts; this file only wires it up. See
 * .context/app/frameworks.md.
 */
import { readFileSync } from 'node:fs';
import { runPublish } from '@/lib/app/frameworks/cli';
import { prismaFrameworkRepo } from '@/lib/app/frameworks/repo';
import { prisma } from '@/lib/db/client';
import { runAsSystem } from '@/lib/tenancy/context';

runPublish(process.argv.slice(2), {
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
