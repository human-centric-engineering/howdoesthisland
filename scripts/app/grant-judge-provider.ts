/**
 * Approve every existing workspace for the judges' provider (t-39).
 *
 *   npx tsx --env-file=.env.local scripts/app/grant-judge-provider.ts
 *
 * Run once per environment **before** a build whose judges default to a new
 * provider is deployed there: a workspace not approved for it would have its
 * judges bound to nothing (see `lib/app/workspaces/judge-provider-grant.ts`).
 * Idempotent: an org already approved is reported and left alone. Needs the
 * provider's row to exist (`scripts/app/dev-tenancy.ts` creates it in
 * development; `/admin/orchestration/providers` elsewhere).
 *
 * Exit 0 done, 1 the provider has no row.
 */
import { grantJudgeProviderToAllOrgs } from '@/lib/app/workspaces/judge-provider-grant';
import { prisma } from '@/lib/db/client';

// A command's own output, for the person who ran it.
const out = (line: string) => console.log(line);

grantJudgeProviderToAllOrgs()
  .then(async (summary) => {
    await prisma.$disconnect();
    if (!summary.providerSlug) {
      out('The judges’ provider has no row; create it first. Nothing granted.');
      process.exit(1);
    }
    out(
      `${summary.providerSlug}: granted to ${summary.granted.length} org(s), ` +
        `${summary.already.length} already approved.`
    );
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(2);
  });
