/**
 * Get every existing workspace ready for the judges' provider (t-39).
 *
 *   npx tsx --env-file=.env.local scripts/app/grant-judge-provider.ts
 *
 * Run once per environment **before** a build whose judges default to a new
 * provider is deployed there: a workspace not approved for it would have its
 * judges bound to nothing. It also hands back to the platform any judge a
 * workspace bound to a model the new build no longer approves. It moves no
 * binding itself, so the running build is unaffected; the new build's
 * maintenance job rebinds once it is serving. See
 * `lib/app/workspaces/judge-provider-grant.ts`.
 *
 * Idempotent: an org already approved is reported and left alone. Needs the
 * provider's row to exist (`scripts/app/dev-tenancy.ts` creates it in
 * development; `/admin/orchestration/providers` elsewhere).
 *
 * Exit 0 done, 1 the provider has no row, 2 failed.
 */
import {
  grantJudgeProviderToAllOrgs,
  releaseUnapprovedBindings,
} from '@/lib/app/workspaces/judge-provider-grant';
import { prisma } from '@/lib/db/client';

// A command's own output, for the person who ran it.
const out = (line: string) => console.log(line);

async function main(): Promise<number> {
  const summary = await grantJudgeProviderToAllOrgs();
  if (!summary.providerSlug) {
    out('The judges’ provider has no row; create it first. Nothing granted.');
    return 1;
  }
  out(
    `${summary.providerSlug}: granted to ${summary.granted.length} org(s), ` +
      `${summary.already.length} already approved.`
  );
  const released = await releaseUnapprovedBindings();
  out(`${released.length} agent(s) on a model no longer approved handed back to the platform.`);
  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(2);
  });
