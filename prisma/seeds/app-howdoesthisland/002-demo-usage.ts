import type { SeedUnit } from '@/prisma/runner';
import { PLATFORM_ADMIN_ROLE } from '@/lib/auth/roles';
import { ORG_OWNER_ROLE } from '@/lib/tenancy/roles';
import { runAsOrg } from '@/lib/tenancy/context';
import { createOrg } from '@/lib/tenancy/lifecycle';
import { writeOrgQuotas } from '@/lib/tenancy/org-settings';
import { utcMonthStart } from '@/lib/orchestration/llm/spend-caps';
import { WORKSPACE_MONTHLY_BUDGET_USD } from '@/lib/app/workspaces/provision';
import { readAppSettings, writeAppSettings } from '@/lib/app/workspaces/app-settings';

/**
 * A month of usage for a demo workspace (t-48), so `/usage` has figures to
 * show on a development database, and on a deployed one that asks for them.
 *
 * **Development only, unless asked.** The rows are made-up spend: on a real
 * install they would count towards the global budget. So the unit does
 * nothing when `NODE_ENV` is `production` unless `SEED_DEMO_USAGE=true`.
 * The runner records a unit as applied either way, so on a database seeded
 * without it, delete this unit's `seed_history` row
 * (`app-howdoesthisland/002-demo-usage`) and seed again.
 *
 * **What it writes**, in its own workspace (`usage-demo`, "Usage demo") with
 * the default $10 budget when it is made, every human platform admin its `OWNER`: two
 * projects, stored reviews in them and in none, each with its judges' and the
 * editor's cost rows; two reviews kept nowhere (`ephemeral` rows only); and
 * one row that is no review. All dated between the first of this month (UTC)
 * and now, about $5.80 in all.
 *
 * **Only its own workspace.** The one it creates is marked
 * (`settings.app.usageDemo`); a `usage-demo` workspace without the mark is
 * someone's real one, and the unit then does nothing.
 *
 * **Re-runnable.** Each run first deletes the demo workspace's reviews,
 * content and cost rows, then writes them again for the current month: the
 * workspace is the demo's alone. Figures dated last month read as zero once
 * the month turns; seed again (as above) to refresh them.
 */
const DEMO_SLUG = 'usage-demo';
const DEMO_NAME = 'Usage demo';
/** Marks the workspace as the demo's (`settings.app`), so the seed never wipes another. */
const DEMO_MARKER = 'usageDemo';

/** The judges every demo review ran, and what each call cost. */
const JUDGES = ['ethos', 'pathos', 'logos', 'audience'] as const;
const JUDGE_COST_USD = 0.09;
const EDITOR_COST_USD = 0.04;

/** Stored reviews: the project each is in (`null` for none), and whether a judge retried. */
const REVIEWS: ReadonlyArray<{ projectId: string | null; retried: boolean }> = [
  { projectId: 'demo-launch', retried: false },
  { projectId: 'demo-launch', retried: true },
  { projectId: 'demo-launch', retried: false },
  { projectId: 'demo-launch', retried: false },
  { projectId: 'demo-launch', retried: false },
  { projectId: 'demo-help-centre', retried: false },
  { projectId: 'demo-help-centre', retried: false },
  { projectId: 'demo-help-centre', retried: true },
  { projectId: null, retried: false },
  { projectId: null, retried: false },
  { projectId: null, retried: false },
  { projectId: null, retried: false },
];

/** The demo's projects, which {@link REVIEWS} name by id. */
const PROJECTS = [
  {
    id: 'demo-launch',
    name: 'Product launch',
    brief: { offer: 'A budgeting app for freelancers', audience: 'Freelancers paid by invoice' },
  },
  {
    id: 'demo-help-centre',
    name: 'Help centre',
    brief: { offer: 'Help articles for the budgeting app', audience: 'People using the app' },
  },
] as const;

const EPHEMERAL_RUNS = 2;

function shouldRun(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_USAGE === 'true';
}

const unit: SeedUnit = {
  name: 'app-howdoesthisland/002-demo-usage',
  async run({ prisma, logger }) {
    if (!shouldRun()) {
      logger.info('Demo usage skipped: production, and SEED_DEMO_USAGE is not true');
      return;
    }

    const version = await prisma.frameworkVersion.findFirst({
      where: { status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      select: { id: true, version: true, framework: { select: { id: true, slug: true } } },
    });
    if (!version) {
      logger.warn('Demo usage skipped: no published framework version to review against');
      return;
    }
    const frameworkVersion = `${version.framework.slug}@${version.version}`;

    const existing = await prisma.org.findUnique({
      where: { slug: DEMO_SLUG },
      select: { id: true, settings: true },
    });
    // The slug is not reserved: a workspace someone named "Usage demo" gets it.
    // Only one this seed made is the demo's to wipe.
    if (existing && readAppSettings(existing.settings)[DEMO_MARKER] !== true) {
      logger.warn(
        `Demo usage skipped: a workspace that is not the demo's already has the slug ${DEMO_SLUG}`
      );
      return;
    }
    // Every write through the client the runner hands the seed, never the global one.
    let orgId = existing?.id;
    if (!orgId) {
      orgId = (await createOrg({ slug: DEMO_SLUG, name: DEMO_NAME }, prisma)).id;
      await writeAppSettings(
        orgId,
        (app) => {
          app[DEMO_MARKER] = true;
        },
        prisma
      );
      // Only when made: a budget someone set on the demo since is theirs.
      await writeOrgQuotas(orgId, { monthlyBudgetUsd: WORKSPACE_MONTHLY_BUDGET_USD }, prisma);
    }

    const admins = await prisma.user.findMany({
      where: { role: PLATFORM_ADMIN_ROLE, accountType: 'HUMAN' },
      select: { id: true },
    });

    // Spread over the month so far: the first of the month (UTC) to now.
    const monthStart = utcMonthStart().getTime();
    // Never ahead of now, even in the month's first moments.
    const span = Math.max(Date.now() - monthStart, 1);
    const total = REVIEWS.length + EPHEMERAL_RUNS + 1;
    const at = (i: number) => new Date(monthStart + Math.floor((span * (i + 0.5)) / total));

    await runAsOrg(orgId, async () => {
      for (const admin of admins) {
        await prisma.orgMembership.upsert({
          where: { orgId_userId: { orgId, userId: admin.id } },
          update: {},
          create: { orgId, userId: admin.id, role: ORG_OWNER_ROLE },
        });
      }

      // Start again: the workspace's reviews (their judge runs cascade) and spend.
      await prisma.assessment.deleteMany({ where: { orgId } });
      await prisma.content.deleteMany({ where: { orgId } });
      await prisma.aiCostLog.deleteMany({ where: { orgId } });

      // The projects the reviews are in (t-70). Fixed ids, so a second run
      // finds them; one someone has edited since is left as it is.
      for (const project of PROJECTS) {
        await prisma.project.upsert({
          where: { id: project.id },
          update: {},
          create: {
            id: project.id,
            orgId,
            name: project.name,
            brief: project.brief,
            defaults: {},
            frameworkId: version.framework.id,
          },
        });
      }

      const costRow = (
        createdAt: Date,
        costUsd: number,
        metadata: Record<string, string | number | boolean>
      ) => ({
        orgId,
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        inputTokens: 3_000,
        outputTokens: 600,
        inputCostUsd: costUsd * 0.4,
        outputCostUsd: costUsd * 0.6,
        totalCostUsd: costUsd,
        operation: 'chat',
        metadata: { frameworkVersion, demoSeed: true, ...metadata },
        createdAt,
      });

      for (const [i, review] of REVIEWS.entries()) {
        const createdAt = at(i);
        const costs = JUDGES.map((judge, j) => {
          const attempts = review.retried && j === 0 ? 2 : 1;
          return { judge, attempts, costUsd: JUDGE_COST_USD * attempts };
        });
        const costUsd = costs.reduce((sum, c) => sum + c.costUsd, 0) + EDITOR_COST_USD;
        const content = await prisma.content.create({
          data: {
            orgId,
            projectId: review.projectId,
            title: `Demo copy ${i + 1}`,
            sourceKind: 'TEXT',
            text: 'Demo copy for the usage page. Nothing here was reviewed.',
            textSha256: `demo-usage-${i + 1}`,
            wordCount: 9,
            createdAt,
          },
        });
        const assessment = await prisma.assessment.create({
          data: {
            orgId,
            contentId: content.id,
            projectId: review.projectId,
            frameworkVersionId: version.id,
            profile: 'full',
            judges: [...JUDGES],
            context: {},
            status: 'FAILED',
            error: 'Demo usage: not a real review.',
            costUsd,
            requestedVia: 'APP',
            createdAt,
            completedAt: createdAt,
            // Demo history, not work anyone is waiting on: no finished event
            // is owed for it (t-99, `lib/app/events/notify.ts`).
            notifiedAt: createdAt,
          },
        });
        await prisma.aiCostLog.createMany({
          data: [
            ...costs.map((c) =>
              costRow(createdAt, c.costUsd, {
                judge: c.judge,
                assessmentId: assessment.id,
                attempts: c.attempts,
              })
            ),
            costRow(createdAt, EDITOR_COST_USD, {
              editor: 'summary',
              assessmentId: assessment.id,
              attempts: 1,
            }),
          ],
        });
      }

      for (let r = 0; r < EPHEMERAL_RUNS; r++) {
        const createdAt = at(REVIEWS.length + r);
        await prisma.aiCostLog.createMany({
          data: JUDGES.map((judge) =>
            costRow(createdAt, JUDGE_COST_USD, {
              judge,
              ephemeral: true,
              ephemeralRun: `demo-ephemeral-${r + 1}`,
              attempts: 1,
            })
          ),
        });
      }

      // Spend that is no review (an embedding, say): the "other" line.
      await prisma.aiCostLog.create({
        data: {
          ...costRow(at(total - 1), 0.12, {}),
          model: 'text-embedding-3-small',
          provider: 'openai',
          operation: 'embedding',
        },
      });
    });

    logger.info('Demo usage written', {
      orgId,
      reviews: REVIEWS.length,
      ephemeralRuns: EPHEMERAL_RUNS,
      owners: admins.length,
    });
    if (admins.length === 0) {
      logger.warn(
        'The demo workspace has no members: no human platform admin exists yet. Seed again after signing up.'
      );
    }
  },
};

export default unit;
