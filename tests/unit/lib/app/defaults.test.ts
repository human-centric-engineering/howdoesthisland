/**
 * Tests: lib/app/ seams ship as no-op defaults
 *
 * Every `lib/app/*` file is a fork-owned scaffold that Sunrise ships EMPTY. This
 * file exercises the REAL defaults to lock in that contract — a stray default
 * registration would silently apply to every install (a lint rule every fork
 * inherits, an auth email swapped out, a restricted agent's document access
 * widened).
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — filling a seam is EXPECTED to fail a row here
 * ---------------------------------------------------------------------------
 * This test asserts a property every fork is expected to violate: the seams
 * exist precisely so you fill them. When you fill one, **pin the new value**
 * rather than deleting the row:
 *
 *     // BEFORE (Sunrise default)
 *     assert: () => expect(appEslintConfig).toEqual([]),
 *     // AFTER  (fork spreads its own tier config)
 *     assert: () => expect(appEslintConfig).toEqual(frameworkEslintConfig),
 *
 * Pinning keeps the protection for the seams you have NOT filled; deleting the
 * row loses it silently. The table below is the whole surface — one row per
 * seam — so a fork's diff here is a line, not a rewrite. See CUSTOMIZATION.md §4.
 *
 * @see lib/app/ · CUSTOMIZATION.md §4
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ownModuleProblems, scaffoldsOnDisk, unlistedSeams } from '@/tests/helpers/app-scaffolds';
import { registerAppRateLimits } from '@/lib/app/rate-limit';
import { registerAppTenantResolver } from '@/lib/app/tenant-resolver';
import { hasTenantResolver } from '@/lib/tenancy/resolver';
import { initAppCapabilities } from '@/lib/app/capabilities';
import {
  hasProviderCredentialResolver,
  resetProviderCredentialResolver,
  resolveProviderCredential,
} from '@/lib/orchestration/llm/provider-credentials';
import { initAppContextContributors } from '@/lib/app/context-contributors';
import { initAppNav } from '@/lib/app/admin-nav';
import { publicNavItems, footerNavItems, footerLegalItems } from '@/lib/app/public-nav';
import { protectedNavItems } from '@/lib/app/protected-nav';
import { appAuthLandingRoute, appAuthLandingLabel } from '@/lib/app/auth-landing';
import { appWelcomeRoute } from '@/lib/app/welcome';
import { initApp } from '@/lib/app/bootstrap';
import { initAppKnowledgeAccessContributors } from '@/lib/app/knowledge-access-contributors';
import { initAppGuardFloorContributors } from '@/lib/app/guard-floor-contributors';
import { initAppGuardEventContributors } from '@/lib/app/guard-event-contributors';
import { appAgentFields } from '@/lib/app/agent-fields';
import { appProtectedRoutes } from '@/lib/app/protected-routes';
import { appCredentialPaths } from '@/lib/app/credential-paths';
import { appEnvSchema } from '@/lib/app/env';
import { footerCopyright } from '@/lib/app/footer';
import { appSegmentLabels } from '@/lib/app/admin-breadcrumbs';
import { appConfigHealthChecks } from '@/lib/app/config-health';
import { APP_API_KEY_SCOPES } from '@/lib/app/api-key-scopes';
import { listValidApiKeyScopes, CORE_API_KEY_SCOPES } from '@/lib/auth/api-key-scopes';
import appEslintConfig from '@/lib/app/eslint.config.mjs';
import { appConnectSrc, appFrameSrc, appMediaSrc, appScriptSrc } from '@/lib/app/csp';
import { resolveAppFrameAncestors } from '@/lib/app/frame-ancestors';
import appFrameablePaths from '@/lib/app/frameable-paths.json';
import {
  appCoverageExclusions,
  appAlwaysRunTests,
  appOwnerlessSurfaceExceptions,
} from '@/lib/app/ci';
import { occupiedTiers } from '@/lib/app/reserved-tiers';
import { appOwnModules } from '@/lib/app/own-modules';
import { APP_CAPABILITY_PAIRS, APP_UNCHECKED_SEEDS } from '@/lib/app/capability-seed-pairs';
import * as userCreatedHooks from '@/lib/auth/user-created-hooks';
import * as orgCreatedHooks from '@/lib/tenancy/org-created-hooks';
import * as signupOrg from '@/lib/tenancy/signup-org';
import * as appModelPins from '@/lib/orchestration/model-lifecycle/app-pins';
import { collectAppSubjectData } from '@/lib/app/data-export';
import { prisma } from '@/lib/db/client';
import {
  getAppSubjectSources,
  getAppExcludedSubjectSources,
  __resetAppSubjectSourceRegistryForTests,
} from '@/lib/privacy/subject-source-registry';
import {
  getAppOrgSources,
  getAppExcludedOrgSources,
  appOrgDeclarationsFailed,
  __resetAppOrgSourceRegistryForTests,
} from '@/lib/privacy/org-source-registry';
import { getAppJobs, __resetAppJobsForTests } from '@/lib/orchestration/maintenance/app-jobs';
import { __resetSealedStoresForTests, getSealedStoreNames } from '@/lib/security/sealed-stores';
import { CORE_SEALED_STORES } from '@/lib/security/core-sealed-stores';
import {
  getAppStaleWriters,
  getErasureCleanupHooks,
  __resetErasureCleanupHooksForTests,
} from '@/lib/privacy/erasure-hooks';
import { getEffectiveRateLimitPolicy, RATE_LIMIT_POLICY } from '@/lib/security/rate-limit-policy';
import {
  hasProviderEligibilityResolver,
  resolveEligibleProviders,
} from '@/lib/orchestration/llm/provider-eligibility';
import { getRegisteredNavSections, __resetNavRegistryForTests } from '@/lib/admin-nav/registry';
import {
  listAppMcpResourceTypes,
  listAllowedMcpResourceUriSchemes,
  __resetAppMcpResourcesForTests,
} from '@/lib/orchestration/mcp/resource-registry';
import {
  listGraders,
  __resetGraderRegistryForTests,
} from '@/lib/orchestration/evaluations/graders/registry';
import {
  registeredEvalCaseHookAgents,
  __resetEvalCaseHooksForTests,
} from '@/lib/orchestration/evaluations/case-hooks';
import {
  CORE_PLATFORM_AGENTS,
  listPlatformAgents,
  __resetPlatformAgentsForTests,
} from '@/lib/orchestration/agents/platform-agents';
import {
  ACCOUNT_SURFACES,
  getRegisteredAccountSections,
  __resetAccountSectionRegistryForTests,
} from '@/lib/account-sections/registry';
import {
  registeredEntitlementSwitches,
  registeredMeters,
  resolveOrgSwitches,
  __resetEntitlementRegistryForTests,
} from '@/lib/tenancy/entitlements';
import { allMeters } from '@/lib/tenancy/meters';
import { appLocaleTags, catalogueFor, __resetAppMessagesForTests } from '@/lib/i18n/registry';
import { supportedLocales } from '@/lib/i18n/locales';
import enMessages from '@/lib/i18n/messages/en.json';
import { ORG_TIER_ADMIN_PAGES, adminPageTier } from '@/lib/auth/admin-tier';
import { APP_ORG_TIER_ADMIN_ROUTES } from '@/lib/app/admin-tier-routes';
import { appOrgAdminLandingRoute } from '@/lib/app/admin-landing';
import { orgAdminLanding } from '@/lib/auth/admin-landing';
import {
  accessExplainerRegistrations,
  __resetAccessExplainerForTests,
} from '@/lib/auth/access-explainer';
import {
  getAppOrgTierAdminPages,
  namedAdminTiers,
  orgTierAdminPages,
  __resetAppOrgTierAdminPagesForTests,
  closedCoreOrgTierSections,
} from '@/lib/auth/org-tier-admin-pages';
import {
  appOwnerClassifications,
  __resetAppOwnerClassificationForTests,
} from '@/lib/db/owner-classification';
import {
  appTenancyClassifications,
  __resetAppTenancyClassificationForTests,
} from '@/lib/tenancy/classification';
import {
  getPrivacyAdapters,
  __resetPrivacyAdaptersForTests,
} from '@/lib/privacy/adapters/registry';
import { corePrivacyAdapters } from '@/lib/privacy/adapters/core-defaults';
import {
  DEFAULT_AUTHORIZATION_POLICY,
  getAuthorizationPolicy,
  hasAppAuthorizationPolicy,
  __resetAuthorizationPolicyForTests,
} from '@/lib/auth/authorization';

// tests/setup.ts pins these seams for every file (#1125, #1139, #1324). This
// file asserts what Sunrise really ships, so it puts the real scaffolds back:
// their rows below read them through the registries' own lazy wiring, which a
// per-row `importActual` would bypass.
vi.mock('@/lib/app/admin-tier', (importOriginal) => importOriginal());
vi.mock('@/lib/app/user-created', (importOriginal) => importOriginal());
vi.mock('@/lib/app/erasure', (importOriginal) => importOriginal());
// FORK (HowDoesThisLand): our tests/setup.ts also pins the authorization seam
// (t-64), so its row reads the real one back. Ledger: row 2.
vi.mock('@/lib/app/authorization', (importOriginal) => importOriginal());

// FORK (HowDoesThisLand): the capabilities row below reads what our seam
// registers (t-92). `lib/app/capabilities.ts` is the only importer of this
// module here. Ledger: .context/app/platform-divergences.md row 2.
const { registerAppCapabilitySpy } = vi.hoisted(() => ({ registerAppCapabilitySpy: vi.fn() }));
vi.mock('@/lib/orchestration/capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/orchestration/capabilities')>()),
  registerAppCapability: registerAppCapabilitySpy,
}));
vi.mock('@/lib/app/org-created', (importOriginal) => importOriginal());
vi.mock('@/lib/app/signup-org', (importOriginal) => importOriginal());
vi.mock('@/lib/app/model-pins', (importOriginal) => importOriginal());
vi.mock('@/lib/app/entitlements', (importOriginal) => importOriginal());
vi.mock('@/lib/app/access-explainer', (importOriginal) => importOriginal());

/**
 * One row per `lib/app/*` seam.
 *
 * - `seam` — the file a fork edits, and the test name.
 * - `risk` — what a stray default here would do to every install. This is the
 *   reason the row exists; keep it accurate if you pin a fork value.
 * - `assert` — runs the REAL default and asserts it registers/overrides nothing.
 *   May be async.
 */
interface SeamDefault {
  seam: string;
  risk: string;
  assert: () => void | Promise<void>;
}

/**
 * Seam files deliberately absent from the table below, with the reason. The
 * drift guard at the bottom of this file allows exactly these two.
 */
/** This file's own repo-relative path: it reads every pinned seam's real scaffold. */
const THIS_FILE = path.join('tests', 'unit', 'lib', 'app', 'defaults.test.ts');
/** Where the suite-wide seam pins are defined. */
const SETUP_FILE = path.join('tests', 'setup.ts');

const UNASSERTED_SEAMS = new Set([
  // Asserted behaviourally instead — see tests/unit/lib/db/drift-probes.test.ts.
  'lib/app/db-drift.ts',
  // The one seam that ships real logic (a classifier) rather than an empty
  // value, so "registers nothing" is not the contract. Covered by its own tests.
  'lib/app/surface.ts',
]);

const SEAM_DEFAULTS: SeamDefault[] = [
  {
    seam: 'lib/app/authorization.ts',
    risk: 'a stray policy would replace the authorization decision at every guarded request and every admin page — the one seam whose default registration would change who can reach what, on every install',
    // FORK (HowDoesThisLand): pinned to our policy (t-64), Sunrise's default with
    // `canAdminister` narrowed to platform admins; the read faces stay the
    // default's by identity. Ledger: .context/app/platform-divergences.md row 2.
    assert: () => {
      // `getAuthorizationPolicy()` runs the fork gate, so this covers the
      // wiring as well as the value.
      const policy = getAuthorizationPolicy();
      expect(hasAppAuthorizationPolicy()).toBe(true);
      expect(policy).not.toBe(DEFAULT_AUTHORIZATION_POLICY);
      expect(policy.canAdminister).not.toBe(DEFAULT_AUTHORIZATION_POLICY.canAdminister);
      expect(policy.canRead).toBe(DEFAULT_AUTHORIZATION_POLICY.canRead);
      expect(policy.subjectScope).toBe(DEFAULT_AUTHORIZATION_POLICY.subjectScope);
      expect(Object.keys(policy).sort()).toEqual(Object.keys(DEFAULT_AUTHORIZATION_POLICY).sort());
    },
  },
  {
    seam: 'lib/app/llm-providers.ts',
    risk: 'a stray eligibility rule would silently drop provider fallbacks on every install',
    assert: async () => {
      // `importActual`, NOT a plain import: tests/setup.ts pins this seam for
      // every other file, and asserting the pin would prove nothing about what
      // Sunrise actually ships. This is the file that must see the real one.
      const seam =
        await vi.importActual<typeof import('@/lib/app/llm-providers')>('@/lib/app/llm-providers');
      await seam.registerAppProviderEligibility();
      expect(hasProviderEligibilityResolver()).toBe(false);
      // BY IDENTITY, not by deep equality: the default has to be the input
      // array itself, which is what makes "byte-identical at single" a fact
      // rather than a claim about equivalent-looking output.
      const candidates = ['anthropic', 'openai'];
      await expect(
        resolveEligibleProviders(candidates, {
          task: 'chat',
          source: 'system',
          primarySlug: 'anthropic',
        })
      ).resolves.toBe(candidates);
    },
  },
  {
    seam: 'lib/app/rate-limit.ts',
    risk: 'a stray tier or rule would re-cap every install',
    // FORK (HowDoesThisLand): pinned to our rules, the free quick scan's
    // per-IP cap (t-24), the share links' (t-32) and the review codes' (t-60). Ledger:
    // .context/app/platform-divergences.md row 2.
    assert: () => {
      registerAppRateLimits();
      const added = getEffectiveRateLimitPolicy().filter((r) => !RATE_LIMIT_POLICY.includes(r));
      expect(added.map((r) => [String(r.match), r.tier, r.key])).toEqual([
        [String(/^\/api\/v1\/scan\/?$/), 'scan', 'ip'],
        [String(/^\/(r|api\/v1\/shared-reports)\/[^/]+\/?$/), 'shared-report', 'ip'],
        [String(/^\/(redeem|api\/v1\/codes\/(check|redeem))\/?$/), 'redeem', 'ip'],
      ]);
    },
  },
  {
    seam: 'lib/app/tenant-resolver.ts',
    risk: 'a stray resolver would pick an org for every request on every install',
    assert: () => {
      registerAppTenantResolver();
      // No resolver → the proxy strips the org header on every request.
      expect(hasTenantResolver()).toBe(false);
    },
  },
  {
    seam: 'lib/app/capabilities.ts',
    risk: 'a stray capability would be dispatchable on every install',
    // Behavioural reach into the dispatcher is covered by bootstrap-wiring.test.ts.
    // FORK (HowDoesThisLand): pinned to our seven MCP tools (t-92, t-93, t-94), each
    // registered once with no slug override, guard or scope binding. Ledger:
    // .context/app/platform-divergences.md row 2.
    assert: () => {
      registerAppCapabilitySpy.mockClear();
      expect(initAppCapabilities()).toBeUndefined();
      expect(
        registerAppCapabilitySpy.mock.calls.map(([cap, options]: unknown[]) => [
          (cap as { slug: string }).slug,
          options,
        ])
      ).toEqual([
        ['quick_scan', undefined],
        ['assess_draft', undefined],
        ['get_assessment', undefined],
        ['compare_drafts', undefined],
        ['get_comparison', undefined],
        ['rewrite_draft', undefined],
        ['get_rewrite', undefined],
      ]);
    },
  },
  {
    seam: 'lib/app/context-contributors.ts',
    risk: 'a stray contributor would inject prompt context into every chat turn',
    // Behavioural reach into buildContext is covered by context-builder.test.ts.
    assert: () => expect(initAppContextContributors()).toBeUndefined(),
  },
  {
    seam: 'lib/app/admin-nav.ts',
    risk: 'a stray section would appear in every install’s admin sidebar',
    // FORK (HowDoesThisLand): pinned to our one section: the Frameworks page
    // (t-38), the CopyCredits page (t-57) and the review codes page (t-59).
    assert: () => {
      __resetNavRegistryForTests();
      initAppNav();
      expect(
        getRegisteredNavSections().map((s) => [s.title, (s.items ?? []).map((i) => i.href)])
      ).toEqual([['HowDoesThisLand', ['/admin/frameworks', '/admin/credits', '/admin/codes']]]);
      __resetNavRegistryForTests();
    },
  },
  {
    seam: 'lib/app/public-nav.ts',
    risk: 'a stray non-null list would silently REPLACE the marketing nav',
    // FORK (HowDoesThisLand): header nav pinned to our routes; the footer lists stay default.
    // Ledger: .context/app/platform-divergences.md row 2.
    assert: () => {
      expect(publicNavItems?.map((i) => i.href)).toEqual([
        '/redeem',
        '/model',
        '/developers',
        '/about',
        '/contact',
      ]);
      expect(footerNavItems).toBeNull();
      expect(footerLegalItems).toBeNull();
    },
  },
  {
    seam: 'lib/app/protected-nav.ts',
    risk: 'a stray non-null list would silently REPLACE the authenticated nav',
    // FORK (HowDoesThisLand): pinned to our signed-in nav, landing on /home.
    // Ledger: .context/app/platform-divergences.md row 2.
    assert: () =>
      expect(protectedNavItems?.map((i) => i.href)).toEqual([
        '/home',
        '/assess',
        '/projects',
        '/usage',
        '/profile',
        '/settings',
        '/admin',
      ]),
  },
  {
    seam: 'lib/app/auth-landing.ts',
    risk: 'a stray value would send every install somewhere else after login',
    // FORK (HowDoesThisLand): pinned to /home (D22).
    // Ledger: .context/app/platform-divergences.md row 2.
    assert: () => {
      expect(appAuthLandingRoute).toBe('/home');
      expect(appAuthLandingLabel).toBe('Home');
    },
  },
  {
    seam: 'lib/app/messages.ts',
    risk: 'a stray string would replace platform text, and a stray locale would become choosable, on every screen of every install',
    assert: () => {
      __resetAppMessagesForTests();
      // The read triggers the lazy init, so this exercises the REAL seam.
      expect(appLocaleTags()).toEqual([]);
      expect(supportedLocales()).toEqual(['en', 'en-XA']);
      expect(catalogueFor('en')).toEqual(enMessages);
    },
  },
  {
    seam: 'lib/app/welcome.ts',
    risk: 'a stray value would send every member of every new org on every install to a welcome page after login',
    assert: () => expect(appWelcomeRoute).toBeNull(),
  },
  {
    seam: 'lib/app/admin-breadcrumbs.ts',
    risk: 'a stray label would rename a breadcrumb segment, and the page title, on every install’s admin',
    // FORK (HowDoesThisLand): pinned to our labels, the CopyCredits page (t-57)
    // and the review codes page (t-59).
    // Ledger: .context/app/platform-divergences.md row 2.
    assert: () =>
      expect(appSegmentLabels).toEqual({ credits: 'CopyCredits', codes: 'Review codes' }),
  },
  {
    seam: 'lib/app/footer.ts',
    risk: 'a stray value would rewrite — or silently remove — the attribution line on every install, on both the public and authenticated footers',
    // FORK (HowDoesThisLand): pinned to our attribution line.
    // Ledger: .context/app/platform-divergences.md row 2.
    assert: () => expect(footerCopyright).toBe('© HowDoesThisLand · The art of changing minds'),
  },
  {
    seam: 'lib/app/emails.ts',
    risk: 'a stray override would swap an auth email for every install',
    assert: async () => {
      // `importActual`, NOT a plain import: tests/setup.ts pins this seam to
      // `{}` for every other file (#895), so a plain import would assert the pin.
      const seam = await vi.importActual<typeof import('@/lib/app/emails')>('@/lib/app/emails');
      expect(seam.emailOverrides).toEqual({});
    },
  },
  {
    seam: 'lib/app/waitlist-config.ts',
    risk: 'a stray config would open a public join form, an admin page and a table of strangers’ addresses on every install',
    assert: async () => {
      // `importActual`, NOT a plain import: tests/setup.ts pins this seam to
      // `null` for every other file, so a plain import would assert the pin.
      const seam = await vi.importActual<typeof import('@/lib/app/waitlist-config')>(
        '@/lib/app/waitlist-config'
      );
      expect(seam.waitlistConfig).toBeNull();
    },
  },
  {
    seam: 'lib/app/data-export.ts',
    risk: 'a stray collector would leak app rows into every install’s subject-access export, and a stray declaration would pre-account for a table nobody decided about',
    assert: async () => {
      // FORK (HowDoesThisLand): pinned to our sections and sources, the
      // workspace invitations (t-9), content and assessments (t-22), share
      // links (t-32), calibration runs (t-37), credit entries (t-57), projects
      // (t-70), the documents added to them (t-74), review codes (t-59) and their redemptions (t-60). The reads are stubbed: this pins the shape, not the query. Ledger:
      // .context/app/platform-divergences.md row 2.
      const reads = [
        vi.spyOn(prisma.workspaceInvitation, 'findMany').mockResolvedValue([] as never),
        vi.spyOn(prisma.content, 'findMany').mockResolvedValue([] as never),
        vi.spyOn(prisma.assessment, 'findMany').mockResolvedValue([] as never),
        vi.spyOn(prisma.reportShare, 'findMany').mockResolvedValue([] as never),
        vi.spyOn(prisma.calibrationRun, 'findMany').mockResolvedValue([] as never),
        vi.spyOn(prisma.creditEntry, 'findMany').mockResolvedValue([] as never),
        vi.spyOn(prisma.project, 'findMany').mockResolvedValue([] as never),
        vi.spyOn(prisma.projectDocument, 'findMany').mockResolvedValue([] as never),
        vi.spyOn(prisma.reviewCode, 'findMany').mockResolvedValue([] as never),
        vi.spyOn(prisma.reviewCodeRedemption, 'findMany').mockResolvedValue([] as never),
        vi.spyOn(prisma.rewrite, 'findMany').mockResolvedValue([] as never),
        // FORK (HowDoesThisLand): comparisons (t-87).
        vi.spyOn(prisma.assessmentSet, 'findMany').mockResolvedValue([] as never),
      ];
      expect(await collectAppSubjectData({ userId: 'user-1', email: 'user@example.com' })).toEqual({
        workspaceInvitations: [],
        contents: [],
        assessments: [],
        reportShares: [],
        calibrationRuns: [],
        creditEntries: [],
        projects: [],
        projectDocuments: [],
        reviewCodes: [],
        codeRedemptions: [],
        rewrites: [],
        comparisons: [],
      });
      for (const read of reads) read.mockRestore();
      // The declaration half (#533). The reads trigger the lazy init, so this
      // exercises the REAL seam. A stray source here would also silence the
      // fork-accounting rule in export-sources.test.ts for that model.
      __resetAppSubjectSourceRegistryForTests();
      expect(getAppSubjectSources().map((source) => [source.model, source.section])).toEqual([
        ['WorkspaceInvitation', 'workspaceInvitations'],
        ['Content', 'contents'],
        ['Assessment', 'assessments'],
        ['ReportShare', 'reportShares'],
        ['CalibrationRun', 'calibrationRuns'],
        ['CreditEntry', 'creditEntries'],
        ['Project', 'projects'],
        // FORK (HowDoesThisLand): the documents a person added to projects (t-74).
        ['ProjectDocument', 'projectDocuments'],
        ['ReviewCode', 'reviewCodes'],
        ['ReviewCodeRedemption', 'codeRedemptions'],
        ['Rewrite', 'rewrites'],
        // FORK (HowDoesThisLand): comparisons of drafts (t-87).
        ['AssessmentSet', 'comparisons'],
      ]);
      // FORK (HowDoesThisLand): and the framework store's four models excluded,
      // holding no personal data (t-10), judge runs (t-22), their replies
      // (t-26), the running places (t-28) and the budget holds (t-50).
      // Ledger row 2.
      expect(getAppExcludedSubjectSources().map((entry) => entry.model)).toEqual([
        'Framework',
        'FrameworkVersion',
        'FrameworkNode',
        'FrameworkLink',
        'JudgeRun',
        'JudgeReply',
        'AssessmentPlace',
        'BudgetHold',
        // FORK (HowDoesThisLand): a draft's place in a comparison (t-87).
        'AssessmentSetMember',
      ]);
    },
  },
  {
    seam: 'lib/app/org-export.ts',
    risk: 'a stray source would read a table into every install\u2019s org export \u2014 and pre-account for an orgId model nobody decided about, silencing the org-manifest coverage rule for it',
    assert: () => {
      __resetAppOrgSourceRegistryForTests();
      // The reads trigger the lazy init, so this exercises the REAL file.
      // FORK (HowDoesThisLand): pinned to our sources, the workspace
      // invitations (t-9), assessments (t-22), judge replies (t-26), share
      // links (t-32), projects (t-70), credit entries (t-57) and code
      // redemptions (t-60). Ledger:
      // .context/app/platform-divergences.md row 2.
      expect(getAppOrgSources().map((source) => [source.model, source.section])).toEqual([
        ['WorkspaceInvitation', 'workspaceInvitations'],
        ['Content', 'contents'],
        ['Assessment', 'assessments'],
        ['JudgeRun', 'judgeRuns'],
        ['JudgeReply', 'judgeReplies'],
        ['ReportShare', 'reportShares'],
        ['CalibrationRun', 'calibrationRuns'],
        ['Project', 'projects'],
        // FORK (HowDoesThisLand): projects' document links (t-74).
        ['ProjectDocument', 'projectDocuments'],
        ['CreditEntry', 'creditEntries'],
        ['ReviewCodeRedemption', 'codeRedemptions'],
        ['Rewrite', 'rewrites'],
        // FORK (HowDoesThisLand): comparisons and their drafts (t-87).
        ['AssessmentSet', 'comparisons'],
        ['AssessmentSetMember', 'comparisonDrafts'],
      ]);
      // FORK (HowDoesThisLand): the running places (t-28) and the budget holds
      // (t-50), leases. Ledger row 2.
      expect(getAppExcludedOrgSources().map((entry) => entry.model)).toEqual([
        'AssessmentPlace',
        'BudgetHold',
      ]);
      expect(appOrgDeclarationsFailed()).toBe(false);
    },
  },
  {
    seam: 'lib/app/owner-classification.ts',
    risk: 'a stray classification would switch the data layer’s owner check on for a model nobody decided was private — refusing reads the product means to allow — or pre-classify a fork model nobody looked at, silencing the coverage guard for it',
    assert: () => {
      __resetAppOwnerClassificationForTests();
      // The read triggers the lazy init, so this exercises the REAL file.
      // FORK (HowDoesThisLand): pinned to our models, the workspace invitation
      // (t-9), content and assessments (t-22), share links (t-32), the credit
      // (t-57) and code (t-59, t-60) models, and projects (t-70), as not
      // personal. Ledger:
      // .context/app/platform-divergences.md row 2.
      expect(
        Object.entries(appOwnerClassifications()).map(([model, rule]) => [model, rule.kind])
      ).toEqual([
        ['WorkspaceInvitation', 'not-personal'],
        ['Content', 'not-personal'],
        ['Assessment', 'not-personal'],
        ['ReportShare', 'not-personal'],
        ['CalibrationRun', 'not-personal'],
        ['CreditEntry', 'not-personal'],
        ['Project', 'not-personal'],
        // FORK (HowDoesThisLand): a project's document link (t-74).
        ['ProjectDocument', 'not-personal'],
        ['ReviewCode', 'not-personal'],
        ['ReviewCodeRedemption', 'not-personal'],
        ['Rewrite', 'not-personal'],
        // FORK (HowDoesThisLand): a comparison of drafts (t-87).
        ['AssessmentSet', 'not-personal'],
      ]);
    },
  },
  {
    seam: 'lib/app/tenancy-classification.ts',
    risk: 'a stray classification would take a model out of the coverage guard’s question on every install, put routes writing it under the shared-settings rule, or — as system on a model with orgId — leave its rows out of row isolation',
    assert: () => {
      __resetAppTenancyClassificationForTests();
      // The read triggers the lazy init, so this exercises the REAL file.
      // FORK (HowDoesThisLand): pinned to our one registration, the framework
      // store's shared-config tables (t-10) and the free review codes (t-59).
      // Ledger: .context/app/platform-divergences.md row 2.
      expect([...appTenancyClassifications().keys()].sort()).toEqual([
        'Framework',
        'FrameworkLink',
        'FrameworkNode',
        'FrameworkVersion',
        'ReviewCode',
      ]);
    },
  },
  {
    seam: 'lib/app/bootstrap.ts',
    risk: 'a stray default would run one-time work on every install boot',
    // That instrumentation calls this in all envs, try/catch-isolated, is
    // covered by tests/unit/instrumentation.test.ts.
    assert: async () => {
      await expect(initApp()).resolves.toBeUndefined();
    },
  },
  {
    seam: 'lib/app/knowledge-access-contributors.ts',
    risk: 'a stray contributor would widen every restricted agent’s document access',
    // Behavioural reach into the resolver is covered by resolveAgentDocumentAccess.test.ts.
    assert: () => expect(initAppKnowledgeAccessContributors()).toBeUndefined(),
  },
  {
    seam: 'lib/app/guard-floor-contributors.ts',
    risk: 'a stray contributor would raise the guard floor on every install',
    assert: () => expect(initAppGuardFloorContributors()).toBeUndefined(),
  },
  {
    seam: 'lib/app/guard-event-contributors.ts',
    risk: 'a stray observer would receive every install’s inline-chat guard events',
    assert: () => expect(initAppGuardEventContributors()).toBeUndefined(),
  },
  {
    seam: 'lib/app/agent-fields.ts',
    risk: 'a stray descriptor would add a field to every install’s agent form',
    assert: () => expect(appAgentFields).toEqual([]),
  },
  {
    seam: 'lib/app/protected-routes.ts',
    risk: 'a stray path would put a public route behind auth on every install',
    // FORK (HowDoesThisLand): pinned to /home, the signed-in landing, and
    // /assess, where a review is started (t-78), /assessments, where a
    // review's report lives (t-29), /usage (t-48), /projects (t-71) and
    // /compare, where a comparison is read (t-89).
    // Ledger: .context/app/platform-divergences.md row 2.
    assert: () =>
      expect(appProtectedRoutes).toEqual([
        '/home',
        '/assess',
        '/assessments',
        '/usage',
        '/projects',
        '/compare',
      ]),
  },
  {
    seam: 'lib/app/config-health.ts',
    risk: 'a stray check would flag a setting as missing on every install, on the overview and, if critical, on every admin page',
    assert: () => expect(appConfigHealthChecks).toEqual([]),
  },
  {
    seam: 'lib/app/credential-paths.ts',
    risk: 'a stray pattern would blank a route word out of every install’s logs and analytics',
    // FORK (HowDoesThisLand): pinned to the share link's two paths (t-32).
    // Ledger: .context/app/platform-divergences.md row 2.
    assert: () =>
      expect(appCredentialPaths).toEqual(['/r/[token]', '/api/v1/shared-reports/[token]']),
  },
  {
    seam: 'lib/app/env.ts',
    risk: 'a stray key would make an unset env var fail boot on every install',
    // FORK (HowDoesThisLand): pinned to our keys, the culture switch (D11,
    // t-11), the quick-scan switch (t-61), the batch size (t-101) and the PDF
    // renderer's Chromium path (t-31), all optional, so an unset env still
    // parses. Ledger: .context/app/platform-divergences.md row 2.
    assert: () => {
      expect(Object.keys(appEnvSchema.shape)).toEqual([
        'CULTURE_MODULE_ENABLED',
        'QUICK_SCAN_ENABLED',
        'APP_BATCH_MAX_ITEMS',
        'PDF_CHROMIUM_PATH',
      ]);
      expect(appEnvSchema.parse({})).toEqual({});
    },
  },
  {
    seam: 'lib/app/eslint.config.mjs',
    risk: 'a stray flat-config block would apply lint rules to every fork',
    // The root eslint.config.mjs spreads this array last; that spread itself is
    // exercised by every `npm run lint` run.
    // FORK (HowDoesThisLand): pinned to our two blocks, the prototype ignore
    // and (t-91) Sunrise's JSX-literals rule turned off for our own routes.
    // Ledger: .context/app/platform-divergences.md row 2.
    assert: () =>
      expect(appEslintConfig).toEqual([
        { ignores: ['prototype/**'] },
        {
          files: [
            'app/(protected)/{assess,assessments,compare,home,projects,usage}/**/*.tsx',
            'app/(protected)/settings/{api-keys,webhooks,workspace}/**/*.tsx',
            'app/(public)/{developers,example-review,model,quick-scan,r,redeem}/**/*.tsx',
            'app/(public)/{opengraph-image,twitter-image}.tsx',
          ],
          rules: { 'react/jsx-no-literals': 'off' },
        },
      ]),
  },
  {
    seam: 'lib/app/jobs.ts',
    risk: 'a stray job would run on every install\u2019s maintenance tick',
    assert: () => {
      __resetAppJobsForTests();
      // getAppJobs() triggers the lazy init, so this exercises the REAL seam.
      // FORK (HowDoesThisLand): pinned to our jobs, assessment recovery (t-22), rewrite recovery (t-81),
      // comparison-verdict recovery (t-88) and the retention purge (t-26). Ledger:
      // .context/app/platform-divergences.md row 2.
      expect(getAppJobs().map((job) => [job.name, job.intervalMs, job.scope])).toEqual([
        ['app:assessment-recovery', 15 * 60 * 1000, 'per-org'],
        ['app:rewrite-recovery', 15 * 60 * 1000, 'per-org'],
        ['app:comparison-verdict-recovery', 15 * 60 * 1000, 'per-org'],
        ['app:finished-events', 15 * 60 * 1000, 'per-org'],
        ['app:retention-purge', 24 * 60 * 60 * 1000, 'per-org'],
        ['app:unclaimed-uploads', 60 * 60 * 1000, 'per-org'],
      ]);
    },
  },
  {
    seam: 'lib/app/erasure.ts',
    risk: 'a stray hook would run inside every account erasure on every install \u2014 deleting external data, or scrubbing rows, that the install never asked it to touch',
    assert: () => {
      __resetErasureCleanupHooksForTests();
      // getErasureCleanupHooks() triggers the lazy init, so this exercises the REAL seam.
      expect(getErasureCleanupHooks()).toEqual([]);
      // The same init declares stale writers too.
      expect(getAppStaleWriters()).toEqual([]);
    },
  },
  {
    seam: 'lib/app/user-created.ts',
    risk: 'a stray hook would run on every signup on every install',
    assert: async () => {
      // The registry has no reader, and a hook need leave no trace when it
      // runs, so watch for the registration itself. A filled init returns
      // undefined too, which is all this row used to assert (#1139).
      userCreatedHooks.__resetUserCreatedHooksForTests();
      // Records without registering, so a fork's hook never runs against u1.
      const register = vi
        .spyOn(userCreatedHooks, 'registerUserCreatedHook')
        .mockImplementation(() => {});
      try {
        // Dispatch runs the lazy init, so this exercises the REAL seam.
        await userCreatedHooks.dispatchUserCreated({
          userId: 'u1',
          email: 'new@example.com',
          name: 'New',
          signupMethod: 'email',
          viaInvitation: false,
          invitation: null,
        });
        expect(register).not.toHaveBeenCalled();
      } finally {
        register.mockRestore();
      }
    },
  },
  {
    seam: 'lib/app/org-created.ts',
    risk: 'a stray hook would run for every new org on every install, and be recorded on each as owed until it succeeds',
    assert: () => {
      orgCreatedHooks.__resetOrgCreatedHooksForTests();
      // Reading the owed keys runs the lazy init, so this exercises the REAL
      // seam; an empty list is what makes createOrg() write nothing extra.
      // FORK (HowDoesThisLand): pinned to our one hook, which equips every new
      // workspace (t-7, t-91). Ledger: .context/app/platform-divergences.md row 2.
      expect(orgCreatedHooks.orgCreatedHookKeys()).toEqual(['app:equip-workspace']);
    },
  },
  {
    seam: 'lib/app/signup-org.ts',
    risk: 'a stray resolver would decide where every self-serve signup lands at multi on every install, instead of an org of their own',
    assert: () => {
      signupOrg.__resetSignupOrgResolverForTests();
      // The read runs the lazy init, so this exercises the REAL seam; no
      // resolver is what gives each self-serve signup an org of their own.
      // FORK (HowDoesThisLand): pinned to our resolver, which only names that
      // org (t-91). Ledger: .context/app/platform-divergences.md row 2.
      expect(signupOrg.hasSignupOrgResolver()).toBe(true);
    },
  },
  {
    seam: 'lib/app/model-pins.ts',
    risk: 'a stray reporter would add uses to every model on every install, a stray check could refuse every model move, and a stray mover would write into every org on every move',
    assert: () => {
      appModelPins.__resetAppModelPinsForTests();
      // The read runs the lazy init, so this exercises the REAL seam; nothing
      // registered is what leaves the finder and the move as they were.
      expect(appModelPins.appModelPinsRegistered()).toEqual({
        reporter: false,
        check: false,
        mover: false,
        failed: false,
      });
    },
  },
  {
    seam: 'lib/app/mcp-resources.ts',
    risk: 'a stray handler would expose app data over MCP to every install\u2019s connected clients',
    assert: () => {
      __resetAppMcpResourcesForTests();
      // Both readers trigger the lazy init, so this exercises the REAL seam.
      expect(listAppMcpResourceTypes()).toEqual([]);
      // Core's own scheme, and nothing else.
      expect(listAllowedMcpResourceUriSchemes()).toEqual(['sunrise']);
    },
  },
  {
    seam: 'lib/app/platform-agents.ts',
    risk: 'a stray definition would be materialised as an agent in every org on every install \u2014 and, on a slug core already uses, would replace the prompt of an agent every org runs',
    assert: () => {
      __resetPlatformAgentsForTests();
      // The read triggers the lazy init, so this exercises the REAL file:
      // exactly core's definitions, the same objects, in the same order.
      // FORK (HowDoesThisLand): pinned to core's followed by our nine judges
      // and the editor (t-17), none replacing a core slug. Ledger:
      // .context/app/platform-divergences.md row 2.
      const listed = listPlatformAgents();
      listed
        .slice(0, CORE_PLATFORM_AGENTS.length)
        .forEach((definition, i) => expect(definition).toBe(CORE_PLATFORM_AGENTS[i]));
      expect(listed.slice(CORE_PLATFORM_AGENTS.length).map((d) => d.slug)).toEqual([
        'hdtl-judge-ethos',
        'hdtl-judge-pathos',
        'hdtl-judge-logos',
        'hdtl-judge-kairos',
        'hdtl-judge-lenses',
        'hdtl-judge-influence',
        'hdtl-judge-craft',
        'hdtl-judge-audience',
        'hdtl-judge-culture',
        'hdtl-editor',
      ]);
    },
  },
  {
    seam: 'lib/app/privacy-adapters.ts',
    risk: 'a stray detector would scan every install\u2019s provider calls, and one with external egress would send their text to another processor; a stray replace would turn a core detector off; a stray resolver or token strategy would change what every protected call sends',
    assert: () => {
      __resetPrivacyAdaptersForTests();
      // The read triggers the lazy init, so this exercises the REAL file. What
      // is left is exactly Sunrise's own defaults, compared by id against the
      // core list so the row stays true as core gains adapters.
      const core = corePrivacyAdapters();
      const adapters = getPrivacyAdapters();
      expect(adapters.appInitFailure).toBeNull();
      expect(adapters.coreFailure).toBeNull();
      // Sorted, because the registry orders detectors by egress, not by the
      // order core declares them.
      expect(adapters.detectors.map((r) => r.id).sort()).toEqual(
        core.detectors.map((d) => d.detector.id).sort()
      );
      expect(adapters.detectors.every((r) => r.core)).toBe(true);
      expect(adapters.tokenStrategy?.id ?? null).toBe(core.tokenStrategy?.id ?? null);
      expect(adapters.policyResolvers.map((r) => r.resolver.id)).toEqual(
        core.policyResolvers.map((r) => r.resolver.id)
      );
      expect(adapters.observers.map((o) => o.id)).toEqual(core.observers.map((o) => o.id));
      expect(adapters.replacedCoreDetectors).toEqual([]);
    },
  },
  {
    seam: 'lib/app/sealed-stores.ts',
    risk: 'a stray store would have every install\u2019s reseal walk read, and rewrite, rows it never asked it to touch',
    assert: () => {
      __resetSealedStoresForTests();
      // getSealedStoreNames() triggers the lazy init, so this exercises the REAL seam.
      // Core's own stores (§137 t-1044) are registered first; the app adds none.
      expect(getSealedStoreNames()).toEqual(CORE_SEALED_STORES.map((store) => store.name));
    },
  },
  {
    seam: 'lib/app/provider-credentials.ts',
    risk: 'a stray credential resolver would send every install\u2019s provider calls out on a key that is not the one its rows name',
    assert: async () => {
      resetProviderCredentialResolver();
      // The read triggers the lazy init, so this exercises the REAL file.
      expect(hasProviderCredentialResolver()).toBe(false);
      // And the default is exactly the env var, on the shared identity.
      process.env.SHIPS_EMPTY_TEST_KEY = 'from-env';
      await expect(
        resolveProviderCredential({
          id: 'p1',
          slug: 'p1',
          name: 'P1',
          providerType: 'anthropic',
          apiKeyEnvVar: 'SHIPS_EMPTY_TEST_KEY',
          isLocal: false,
        })
      ).resolves.toEqual({ apiKey: 'from-env', identity: '', ownKey: false });
      delete process.env.SHIPS_EMPTY_TEST_KEY;
    },
  },
  {
    seam: 'lib/app/evaluations.ts',
    risk: 'a stray grader would appear in every install\u2019s metric picker \u2014 and, on a slug core already uses, would silently rescore every run; a stray case hook would run setup and observe around every eval case of that agent',
    assert: () => {
      // The registry module is driven directly, so core's barrel has not
      // side-effect-registered anything: whatever listGraders() returns here
      // came from the seam. The read triggers the lazy init, so this exercises
      // the REAL file.
      __resetGraderRegistryForTests();
      expect(listGraders()).toEqual([]);
      // The file's second init, initAppEvalCaseHooks(), the same way.
      __resetEvalCaseHooksForTests();
      expect(registeredEvalCaseHookAgents()).toEqual([]);
    },
  },
  {
    seam: 'lib/app/account-sections.ts',
    risk: 'a stray section would appear on every install\u2019s /profile and /settings',
    assert: () => {
      __resetAccountSectionRegistryForTests();
      // The read triggers the lazy init, so this exercises the REAL seam.
      // FORK (HowDoesThisLand): pinned to our one section, the API-keys link,
      // on /settings only (t-43).
      expect(getRegisteredAccountSections('settings').map((s) => s.id)).toEqual(['api-keys']);
      for (const surface of ACCOUNT_SURFACES.filter((s) => s !== 'settings')) {
        expect(getRegisteredAccountSections(surface)).toEqual([]);
      }
    },
  },
  {
    seam: 'lib/app/entitlements.ts',
    risk: 'a stray switch would appear on every org page, and one on by default (whenNothingSet) would be granted to every org nobody had set it on, on every install; a stray `seats` meter would replace the platform’s own seats count, and so who the seats limit refuses',
    assert: () => {
      __resetEntitlementRegistryForTests();
      // The read triggers the lazy init, so this exercises the REAL seam.
      expect(registeredEntitlementSwitches()).toEqual([]);
      // …so nothing an org stores, or does not, gives it a switch.
      expect(resolveOrgSwitches({ on: [], off: [], unreadable: false }).on).toEqual([]);
      // No meter either (t-1035), so the only one is the platform's own seats.
      expect(registeredMeters()).toEqual([]);
      expect(allMeters().map((m) => ({ key: m.key, core: m.core }))).toEqual([
        { key: 'seats', core: true },
      ]);
    },
  },
  {
    seam: 'lib/app/admin-tier.ts',
    risk: 'a stray pattern would open that admin page to every org OWNER/ADMIN on every install — the page only, since its API routes declare their own tier, but a page core meant for platform admins alone; a stray closeCoreOrgTierSection() would shut orchestration to every org admin on every install',
    assert: () => {
      __resetAppOrgTierAdminPagesForTests();
      // No named tier (t-999): a stray one would open every fork route that
      // declares its name to whoever its holds() admits, on every install.
      expect(namedAdminTiers()).toEqual([]);
      // The read triggers the lazy init, so this exercises the REAL seam.
      expect(getAppOrgTierAdminPages()).toEqual([]);
      // …and the roster the layout reads and hands the gate is exactly core's.
      expect(orgTierAdminPages()).toEqual(ORG_TIER_ADMIN_PAGES);
      expect(adminPageTier('/admin/users', orgTierAdminPages())).toBeNull();
      // …and it closes none of core's sections (t-929), so the routes keep
      // the tier they declare.
      expect(closedCoreOrgTierSections()).toEqual([]);
    },
  },
  {
    seam: 'lib/app/access-explainer.ts',
    risk: "a stray area, platform-only surface or section would show every install's admins words about access that are not theirs, a stray audience would hide one of the explainer's own sections from them, and a stray permission row or restated cell would publish a role model the install's policy does not enforce; it opens and closes nothing",
    assert: () => {
      __resetAccessExplainerForTests();
      // The read triggers the lazy init, so this exercises the REAL seam.
      const registered = accessExplainerRegistrations();
      expect([...registered.areas.keys()]).toEqual([]);
      expect([...registered.platformOnly.keys()]).toEqual([]);
      expect([...registered.sections.keys()]).toEqual([]);
      expect([...registered.audiences.keys()]).toEqual([]);
      expect([...registered.permissions.keys()]).toEqual([]);
      expect([...registered.permissionOverrides.keys()]).toEqual([]);
    },
  },
  {
    seam: 'lib/app/admin-tier-routes.ts',
    risk: "a stray entry would let a route declaring tier 'org' pass the roster test without core's list naming it — it opens nothing by itself, but the opening would no longer show in the diff a reviewer reads",
    assert: () => expect(APP_ORG_TIER_ADMIN_ROUTES).toEqual([]),
  },
  {
    seam: 'lib/app/admin-landing.ts',
    risk: 'a stray route would send every org OWNER/ADMIN on every install somewhere other than their orchestration dashboard when they open the console',
    assert: () => {
      expect(appOrgAdminLandingRoute).toBeNull();
      // …and /admin sends an org admin exactly where it did before the seam.
      expect(orgAdminLanding()).toBe('/admin/orchestration');
    },
  },
  {
    seam: 'lib/app/api-key-scopes.ts',
    risk: 'a stray scope would be mintable on every install \u2014 and a name colliding with a core scope would change what an existing key satisfies',
    // FORK (HowDoesThisLand): pinned to `assess` (t-24), `reports` (t-31) and
    // `projects` (t-70).
    // Ledger: .context/app/platform-divergences.md row 2.
    assert: () => {
      expect(APP_API_KEY_SCOPES).toEqual(['assess', 'reports', 'projects']);
      // …and the union it feeds is core plus ours, by value not just by length.
      expect(listValidApiKeyScopes()).toEqual([
        ...CORE_API_KEY_SCOPES,
        'assess',
        'reports',
        'projects',
      ]);
    },
  },
  {
    seam: 'lib/app/reserved-tiers.ts',
    risk: 'a stray entry would switch OFF the guard that keeps a reserved tier empty — and it is upstream, where core is the only thing that could put a file there, that the guard is the promise rather than a formality',
    // FORK (HowDoesThisLand): pinned to the tiers we fill: our components and our docs.
    // Ledger: .context/app/platform-divergences.md row 2.
    assert: () => expect(occupiedTiers).toEqual(['components/app', '.context/app']),
  },
  {
    seam: 'lib/app/own-modules.ts',
    risk: 'a stray entry would exempt a lib/app/ entry from the version contract, the fork guide and this table on every install, so a real seam could ship with no breaking-change announcement',
    // Not pinned to []: a leaf fork that declares its modules would otherwise
    // edit this row, in a Sunrise file, which is the cost #847 removes. What
    // it asserts still fails on a stray upstream entry, because every seam
    // Sunrise ships has a row here or in UNASSERTED_SEAMS, and an entry with
    // a row is refused. Upstream, that leaves no declarable entry at all.
    assert: () =>
      expect(
        ownModuleProblems(appOwnModules, scaffoldsOnDisk(), {
          SEAM_DEFAULTS: SEAM_DEFAULTS.map((s) => s.seam),
          UNASSERTED_SEAMS: [...UNASSERTED_SEAMS],
        }),
        'lib/app/own-modules.ts declares entries that cannot be honoured (see each message)'
      ).toEqual([]),
  },
  {
    seam: 'lib/app/capability-seed-pairs.ts',
    risk: 'a stray pair fails the capability parity test on every install (for a slug no seed writes it is a pair nothing wrote, for a slug core already pairs a duplicate), and a stray unchecked seed switches the parity checks off for that seed',
    assert: () => {
      // FORK (HowDoesThisLand): pinned to our seven MCP tools' pairs (t-92, t-93, t-94).
      // Ledger: .context/app/platform-divergences.md row 2.
      expect(APP_CAPABILITY_PAIRS.map((p) => [p.slug, p.instance.constructor.name])).toEqual([
        ['quick_scan', 'QuickScanCapability'],
        ['assess_draft', 'AssessDraftCapability'],
        ['get_assessment', 'GetAssessmentCapability'],
        ['compare_drafts', 'CompareDraftsCapability'],
        ['get_comparison', 'GetComparisonCapability'],
        ['rewrite_draft', 'RewriteDraftCapability'],
        ['get_rewrite', 'GetRewriteCapability'],
      ]);
      expect(APP_UNCHECKED_SEEDS).toEqual({});
    },
  },
  {
    seam: 'lib/app/brand.ts',
    risk: 'a stray value would rebrand every install — page titles, both footers’ copyright line, the root meta description and every transactional email — and the legal-entity field is a legal-attribution surface, not a cosmetic one',
    // `importActual`, NOT a plain import: tests/setup.ts pins this seam to null
    // for the whole suite so that no core test reads a fork's brand. Importing
    // it normally here would therefore assert the MOCK ships null, which is true
    // by construction and would keep passing in a fork that had filled the real
    // file — turning the one row that tells a fork to pin its value into a row
    // that can never fail.
    assert: async () => {
      const seam = await vi.importActual<typeof import('@/lib/app/brand')>('@/lib/app/brand');
      // FORK (HowDoesThisLand): pinned to our name and description; no legal
      // entity is named yet, so that field stays at the default.
      // Ledger: .context/app/platform-divergences.md row 2.
      expect(seam.appBrandName).toBe('HowDoesThisLand');
      expect(seam.appBrandLegalName).toBeNull();
      expect(seam.appBrandDescription).toMatch(/^HowDoesThisLand reads your CV/);
    },
  },
  {
    seam: 'lib/app/csp.ts',
    risk: 'a stray origin would widen the iframe, script, connect or media policy on every install — a script origin runs third-party code with the app’s privileges',
    // These values are spliced straight into a response header, so an
    // accidental default here is a security change, not a cosmetic one.
    assert: () => {
      expect(appFrameSrc).toEqual([]);
      expect(appScriptSrc).toEqual([]);
      expect(appConnectSrc).toEqual([]);
      expect(appMediaSrc).toEqual([]);
    },
  },
  {
    seam: 'lib/app/frame-ancestors.ts',
    risk: 'a stray answer would let the named sites frame pages on every install — the clickjacking protection every response carries, switched off',
    assert: async () => {
      for (const url of ['https://app.example.com/', 'https://app.example.com/embed/widget-1']) {
        expect(await resolveAppFrameAncestors(new Request(url))).toEqual([]);
      }
    },
  },
  {
    seam: 'lib/app/frameable-paths.json',
    risk: 'a stray prefix would take those paths out of next.config.js’s blanket X-Frame-Options: DENY on every install, leaving the proxy as their only framing header',
    assert: () => expect(appFrameablePaths).toEqual([]),
  },
  {
    seam: 'lib/app/ci.ts',
    risk: 'a stray coverage exclusion would switch the per-file 80% floor OFF for that path on every install, a stray always-run entry would make every scoped run load a test whose file the install may not even have, and a stray ownerless-surface exception would let a route read rows nobody owns without the policy being asked — the first silences a gate, the second breaks the gate that replaced it, the third exempts a file from the authorization seam',
    assert: () => {
      // FORK (HowDoesThisLand): pinned to our one exclusion, the signup
      // workspace smoke (t-7). Ledger: .context/app/platform-divergences.md row 2.
      expect(appCoverageExclusions.map((e) => e.pattern)).toEqual([
        'scripts/app/smoke-signup-workspace.ts',
        // FORK (HowDoesThisLand): and the framework store's smoke and commands (t-10).
        'scripts/app/smoke-framework-store.ts',
        // FORK (HowDoesThisLand): and the credit charge's race smoke (t-58).
        'scripts/app/smoke-credit-charge.ts',
        // FORK (HowDoesThisLand): and the rewrite charge's smoke (t-81, t-85).
        'scripts/app/smoke-rewrite-charge.ts',
        // FORK (HowDoesThisLand): and the batch smoke (t-101).
        'scripts/app/smoke-batch.ts',
        // FORK (HowDoesThisLand): and the MCP tools smoke (t-92).
        'scripts/app/smoke-mcp-tools.ts',
        // FORK (HowDoesThisLand): and the judge smoke (t-19).
        'scripts/app/smoke-judge.ts',
        'scripts/app/frameworks/*.ts',
        // FORK (HowDoesThisLand): and the engine-baseline recorder (t-12).
        'scripts/app/baseline/record.ts',
        // FORK (HowDoesThisLand): and the calibrate command and the prototype
        // totals recorder (t-37).
        'scripts/app/calibrate.ts',
        'scripts/app/calibration/record-prototype.ts',
        // FORK (HowDoesThisLand): and the judge-model measurement tool and the
        // judge-provider grant (t-39).
        'scripts/app/calibration/measure-judge-model.ts',
        'scripts/app/grant-judge-provider.ts',
      ]);
      // FORK (HowDoesThisLand): pinned to our two repo-reading tests, the
      // prototype import guard and the baseline drift check (t-12).
      // Ledger: .context/app/platform-divergences.md row 2.
      expect(appAlwaysRunTests.map((e) => e.path)).toEqual([
        'tests/unit/lib/app/prototype-guard.test.ts',
        'tests/unit/scripts/app/baseline/fixtures.test.ts',
      ]);
      expect(appOwnerlessSurfaceExceptions).toEqual([]);
    },
  },
];

afterEach(() => {
  __resetNavRegistryForTests();
  __resetAccountSectionRegistryForTests();
  __resetAppOrgTierAdminPagesForTests();
  __resetAuthorizationPolicyForTests();
});

describe('lib/app/ seams ship empty', () => {
  it.each(SEAM_DEFAULTS)('$seam registers nothing by default', async ({ assert }) => {
    await assert();
  });

  // The guards that judge a fork's REAL seam read it past the pin, and only
  // they may (#1125, #1139). tests/setup.ts defines the pins, so it reads the
  // real module too: the brand pin derives its keys from it.
  const ROSTER = path.join('tests', 'unit', 'scripts', 'ci', 'admin-tier-roster.test.ts');
  const STALE = path.join('tests', 'unit', 'lib', 'privacy', 'stale-writers.test.ts');
  // Compares each pinned init against the real one, so it reads past the pin.
  const PINS = path.join('tests', 'unit', 'setup-seam-pins.test.ts');
  it.each([
    ['brand', 'brand', []],
    ['emails', 'email-override', []],
    ['waitlist-config', 'waitlist-config', []],
    ['llm-providers', 'provider-eligibility', []],
    ['admin-tier', 'org-tier admin', [ROSTER, PINS]],
    ['user-created', 'user-created', [PINS]],
    ['org-created', 'org-created', [PINS]],
    ['signup-org', 'signup-org', [PINS]],
    ['model-pins', 'model-pins', [PINS]],
    ['entitlements', 'entitlements', [ROSTER, PINS]],
    ['erasure', 'erasure', [STALE, PINS]],
    // FORK (HowDoesThisLand): the authorization pin our setup adds (t-64). Ledger: row 2.
    ['authorization', 'authorization', [PINS]],
  ])('nothing but its readers escapes the suite-wide %s-seam pin', (seam, label, readers) => {
    // tests/setup.ts mocks `@/lib/app/brand` to null for EVERY test file, so
    // that no core test can read a fork's brand and fail for a reason the fork
    // cannot fix (#660/#661). That guarantee holds across all ~1095 test files
    // by construction, but only while nothing escapes the mock.
    //
    // `vi.importActual` is legitimate here: it is what makes the brand row
    // above assert the REAL scaffold rather than the mock, which is what keeps
    // "seams ship empty" able to fail in a fork. Elsewhere, only a guard that
    // judges a fork's real seam may read past its pin, and it is listed.
    //
    // `vi.doUnmock` is never right. It REMOVES the pin instead of restoring it,
    // so every later case in that file sees the real seam. That is not
    // hypothetical: it shipped twice during this change — once in this suite's
    // own brand tests (13 cases failed against a filled seam) and once in
    // layout-metadata, where it was invisible only because every remaining case
    // happened to re-stub first. To go back to the null default mid-file,
    // re-`doMock` it; do not unmock it.
    //
    // Matched by REGEX over vitest's whole unmocking surface, not by two string
    // literals. The literal version missed `vi.unmock` — a third escape route —
    // and was also defeated by double quotes or a line-wrapped call. That is the
    // enumerating-guard failure mode this repo keeps meeting: it fails one
    // instance per round. vitest exposes exactly `unmock` and `doUnmock` for
    // removing a mock, so anchoring on `(?:do)?unmock` is exhaustive over the API
    // rather than over the spellings someone happened to think of.
    // The emails pin (#895) is the same shape and the same hazard, and so are
    // the later pins, so every seam setup.ts pins shares the guard.
    //
    // A `vi.mock(seam, (importOriginal) => importOriginal())` restores the real
    // seam just as `importActual` does, so it is matched too. Only the files
    // listed as a seam's readers may do either, and the seam's own test: a fork
    // that fills `lib/app/erasure.ts` tests its hook in
    // `tests/unit/lib/app/erasure.test.ts` (or `erasure.<aspect>.test.ts`), and
    // that file has to read the real seam. Sunrise ships none for these seams.
    const ownTest = new RegExp(
      '^' +
        path.join('tests', 'unit', 'lib', 'app', seam).replaceAll('\\', '\\\\') +
        String.raw`(\.[\w-]+)?\.test\.tsx?$`
    );
    const seamPath = String.raw`['"\`]@/lib/app/` + seam + String.raw`['"\`]`;
    const unmockRe = new RegExp(String.raw`\bvi\s*\.\s*(?:do)?[Uu]nmock\s*\(\s*` + seamPath);
    const actualRe = new RegExp(String.raw`importActual[\s\S]{0,80}?` + seamPath);
    const restoreRe = new RegExp(
      String.raw`\bvi\s*\.\s*(?:do)?[Mm]ock\s*\(\s*` +
        seamPath +
        String.raw`[\s\S]{0,120}?importOriginal`
    );
    const mayRead = new Set([THIS_FILE, SETUP_FILE, ...readers]);

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const src = readFileSync(full, 'utf8');
        const rel = path.relative(process.cwd(), full);
        if (unmockRe.test(src)) {
          offenders.push(`${rel}: unmocks the pin instead of restoring it`);
        }
        if (
          (actualRe.test(src) || restoreRe.test(src)) &&
          !mayRead.has(rel) &&
          !ownTest.test(rel)
        ) {
          offenders.push(`${rel}: reads the real seam past the pin`);
        }
      }
    };
    walk(path.join(process.cwd(), 'tests'));

    expect(
      offenders,
      `These test files escape the ${label}-seam pin in tests/setup.ts. A fork that ` +
        `fills lib/app/${seam}.ts would see its own values here and fail a core test ` +
        'it cannot fix — the exact class #660 is about. Re-doMock the pinned values ' +
        'instead of unmocking, and leave reading the real seam to the guards that judge it.'
    ).toEqual([]);
  });

  it('has a row for every seam file in lib/app/', () => {
    // Drift guard: adding a `lib/app/*` seam without adding a row above would
    // leave it silently unprotected. Reads the directory rather than trusting
    // the table to be complete, through the classifier the VERSIONING.md guard
    // uses (#734): a nested `lib/app/<name>/` seam is owed a row keyed
    // `lib/app/<name>/`, and a file of any extension is owed one too.
    const onDisk = scaffoldsOnDisk();

    // A leaf fork's own modules (lib/app/own-modules.ts) are not seams and owe
    // no row (#847).
    const covered = new Set(SEAM_DEFAULTS.map((s) => s.seam));
    const missing = unlistedSeams([...covered, ...UNASSERTED_SEAMS]);
    const stale = [...covered].filter((f) => !onDisk.includes(f));

    expect(missing, 'lib/app/ seam with no row in SEAM_DEFAULTS').toEqual([]);
    expect(stale, 'SEAM_DEFAULTS row for a file that no longer exists').toEqual([]);
  });
});
