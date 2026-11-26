/**
 * Smoke: HowDoesThisLand's MCP tools through the real transport (t-92, t-93, t-94).
 *
 * What no unit test can prove: that a key bound to a workspace reaches the
 * tools through `POST /api/v1/mcp` on a running server, which registers the
 * app's capabilities in the route-handler realm, runs the call inside the
 * key's workspace with its creator as the person, and answers through the
 * dispatcher's whole pipeline against the real database and row-level
 * security.
 *
 * Makes a throwaway workspace with two finished reviews (scored by the quick
 * scan, so no judge is called and nothing is billed), a comparison of them,
 * a finished rewrite of one (written as a row: no editor is called) and an
 * MCP key, switches the MCP server and the tools on if they are off,
 * then: `tools/list`, `quick_scan`, `get_assessment`, `get_comparison` and
 * `get_rewrite` on
 * the workspace's own, and each read on another workspace's. Puts the
 * switches back and erases the workspaces, key and all, at the end.
 * `assess_draft`, `compare_drafts` and `rewrite_draft` are not called: they
 * would run the judges or the editor, which cost money.
 *
 * Needs the dev server running (`npm run dev`) and a seeded database
 * (`npm run db:seed`, for the capability rows), and a user to own the key:
 * the dev test account, or `SMOKE_MCP_USER_EMAIL`.
 *
 *   npx tsx --env-file=.env.local scripts/app/smoke-mcp-tools.ts [baseUrl]
 *
 * `baseUrl` defaults to `NEXT_PUBLIC_APP_URL`. Behind a local HTTPS proxy with
 * its own CA, add `NODE_OPTIONS=--use-system-ca`. `SMOKE_MCP_SHOW=1` prints
 * what `quick_scan` and `get_assessment` answered, as an assistant reads it.
 */
import { z } from 'zod';
import { runQuickScan } from '@/lib/app/assessments/api/scan';
import { MCP_TOOL_ROWS } from '@/lib/app/mcp/definitions';
import { createWorkspaceOrg } from '@/lib/app/workspaces/provision';
import { prisma } from '@/lib/db/client';
import { generateApiKey } from '@/lib/orchestration/mcp/auth';
import { eraseOrg } from '@/lib/privacy/erase-org';
import { isMultiTenant, runAsOrg, runAsSystem } from '@/lib/tenancy/context';

const BASE_URL = process.argv[2] ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const OWNER_EMAIL = process.env.SMOKE_MCP_USER_EMAIL ?? 'report-check@example.test';
const DRAFT =
  'Our new scheduling tool will revolutionise how your team works. It is the best on the market. Sarah at Acme saved four hours a week in her first month, and so can you. Book a demo today.';

const REWRITTEN =
  'Our scheduling tool saved Sarah at Acme [ADD: the hours saved] in her first month. Book a demo to see what it saves your team.';

let failures = 0;

function check(ok: boolean, what: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures++;
}

const system = <T>(fn: () => Promise<T>) => runAsSystem('smoke: mcp tools', fn);

const rpcAnswer = z.object({
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
const toolList = z.object({ tools: z.array(z.object({ name: z.string() })) });
const toolResult = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  isError: z.boolean().optional(),
});

let nextId = 1;
async function rpc(key: string, method: string, params: Record<string, unknown>) {
  const response = await fetch(`${BASE_URL}/api/v1/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${key}`,
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  const body = rpcAnswer.parse(await response.json());
  if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  return body.result;
}

/** A tool call's answer: its first text block parsed as JSON, and whether it is an error. */
async function callTool(key: string, name: string, args: Record<string, unknown>) {
  const result = toolResult.parse(await rpc(key, 'tools/call', { name, arguments: args }));
  const text = result.content.find((c) => c.type === 'text')?.text ?? 'null';
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // An error's text is a sentence, not JSON.
  }
  return { isError: result.isError === true, data, text };
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;

async function main(): Promise<number> {
  check(isMultiTenant(), 'TENANCY_MODE is multi');
  const owner = await system(() =>
    prisma.user.findUnique({ where: { email: OWNER_EMAIL }, select: { id: true } })
  );
  if (!owner) {
    console.log(`  ✗ no user ${OWNER_EMAIL} to own the key; set SMOKE_MCP_USER_EMAIL`);
    return 1;
  }
  const version = await system(() =>
    prisma.frameworkVersion.findFirst({
      where: { status: 'PUBLISHED' },
      select: { id: true },
      orderBy: { publishedAt: 'desc' },
    })
  );
  if (!version) {
    console.log('  ✗ no published framework version; run smoke-framework-store');
    return 1;
  }
  const capabilities = await system(() =>
    prisma.aiCapability.findMany({
      where: { slug: { in: MCP_TOOL_ROWS.map((r) => r.definition.name) } },
      select: { id: true, slug: true, isActive: true },
    })
  );
  check(
    capabilities.length === MCP_TOOL_ROWS.length && capabilities.every((c) => c.isActive),
    `the ${MCP_TOOL_ROWS.length} capability rows are seeded and active (run npm run db:seed if not)`
  );
  if (failures > 0) return 1;

  // Switch the server and the tools on, remembering what to put back.
  const config = await system(() =>
    prisma.mcpServerConfig.upsert({
      where: { slug: 'global' },
      update: {},
      create: { slug: 'global' },
    })
  );
  const exposedBefore = await system(() =>
    prisma.mcpExposedTool.findMany({
      where: { capabilityId: { in: capabilities.map((c) => c.id) } },
      select: { capabilityId: true, isEnabled: true },
    })
  );
  const stamp = Date.now();
  // Everything that changes the install sits inside the try, so the finally
  // puts back whatever was done before a step threw.
  const made: { id: string }[] = [];
  try {
    await system(async () => {
      await prisma.mcpServerConfig.update({ where: { id: config.id }, data: { isEnabled: true } });
      for (const c of capabilities) {
        await prisma.mcpExposedTool.upsert({
          where: { capabilityId: c.id },
          update: { isEnabled: true },
          create: { capabilityId: c.id, isEnabled: true },
        });
      }
    });
    const org = await system(() => createWorkspaceOrg('Smoke MCP tools', `smoke-mcp-${stamp}`));
    made.push(org);
    const other = await system(() =>
      createWorkspaceOrg('Smoke MCP tools (other)', `smoke-mcp-other-${stamp}`)
    );
    made.push(other);
    const scan = await runAsOrg(org.id, () => runQuickScan({ text: DRAFT }));
    const makeReview = (orgId: string, tag: string) =>
      runAsOrg(orgId, async () => {
        const content = await prisma.content.create({
          data: {
            orgId,
            sourceKind: 'TEXT',
            text: DRAFT,
            textSha256: `smoke-mcp-${stamp}-${tag}`,
            wordCount: scan.wordCount,
          },
        });
        return prisma.assessment.create({
          data: {
            orgId,
            contentId: content.id,
            frameworkVersionId: version.id,
            profile: 'quick',
            judges: [],
            context: scan.context as object,
            status: 'COMPLETED',
            result: scan.result as object,
            overall: scan.overall,
            band: scan.band,
            requestedVia: 'API',
            completedAt: new Date(),
          },
          select: { id: true },
        });
      });
    const review = await makeReview(org.id, 'a');
    const second = await makeReview(org.id, 'b');
    const elsewhere = await makeReview(other.id, 'a');
    // Quick-scan reviews call no judge, so the verdict is skipped, as the service writes it.
    const makeComparison = (orgId: string, reviews: { id: string }[]) =>
      runAsOrg(orgId, () =>
        prisma.assessmentSet.create({
          data: {
            orgId,
            kind: 'COMPARISON',
            frameworkVersionId: version.id,
            profile: 'quick',
            judges: [],
            context: scan.context as object,
            createdByUserId: owner.id,
            verdictStatus: 'SKIPPED',
            verdictReason: 'too_few_judges',
            members: {
              create: reviews.map((r, position) => ({
                orgId,
                assessmentId: r.id,
                position,
                label: `Draft ${position + 1}`,
              })),
            },
          },
          select: { id: true },
        })
      );
    const comparison = await makeComparison(org.id, [review, second]);
    const theirComparison = await makeComparison(other.id, [elsewhere]);
    // As the service ends one: completed, with a placeholder for the writer.
    const makeRewrite = (orgId: string, assessmentId: string) =>
      runAsOrg(orgId, () =>
        prisma.rewrite.create({
          data: {
            orgId,
            assessmentId,
            focus: 'balanced',
            status: 'COMPLETED',
            draft: REWRITTEN,
            createdByUserId: owner.id,
            completedAt: new Date(),
          },
          select: { id: true },
        })
      );
    const rewrite = await makeRewrite(org.id, review.id);
    const theirRewrite = await makeRewrite(other.id, elsewhere.id);

    const { plaintext, hash, prefix } = generateApiKey();
    const key = await runAsOrg(org.id, () =>
      prisma.mcpApiKey.create({
        data: {
          name: 'Smoke MCP tools',
          keyHash: hash,
          keyPrefix: prefix,
          scopes: ['tools:list', 'tools:execute'],
          orgId: org.id,
          createdBy: owner.id,
        },
        select: { id: true },
      })
    );

    const listed = toolList.parse(await rpc(plaintext, 'tools/list', {}));
    const names = listed.tools.map((t) => t.name);
    for (const row of MCP_TOOL_ROWS) {
      check(names.includes(row.definition.name), `tools/list shows ${row.definition.name}`);
    }

    const scanned = await callTool(plaintext, 'quick_scan', { text: DRAFT });
    check(
      !scanned.isError &&
        field(scanned.data, 'overall') === scan.overall &&
        typeof field(scanned.data, 'caveat') === 'string',
      `quick_scan scores the draft as the library does (${String(field(scanned.data, 'overall'))}, ${String(field(scanned.data, 'band'))})`
    );

    // The transport's audit row is written after it answers; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const audit = await system(() =>
      prisma.mcpAuditLog.findFirst({
        where: { apiKeyId: key.id, toolSlug: 'quick_scan' },
        orderBy: { createdAt: 'desc' },
        select: { requestParams: true },
      })
    );
    check(
      audit !== null && !JSON.stringify(audit.requestParams).includes('Sarah'),
      `the MCP audit log keeps no words of the draft (${JSON.stringify(audit?.requestParams ?? null).slice(0, 90)})`
    );

    const read = await callTool(plaintext, 'get_assessment', { assessmentId: review.id });
    if (process.env.SMOKE_MCP_SHOW) console.log(scanned.text, '\n', read.text);
    check(
      !read.isError && field(read.data, 'ready') === true && field(read.data, 'id') === review.id,
      `get_assessment reads the workspace's review (${read.isError ? read.text : `ready, ${String(field(read.data, 'band'))}`})`
    );
    check(
      String(field(read.data, 'reportUrl')).endsWith(`/assessments/${review.id}`),
      'and links its report'
    );
    check(!read.text.includes('textSha256'), 'and answers the summary, not the row');

    const refused = await callTool(plaintext, 'get_assessment', { assessmentId: elsewhere.id });
    check(
      refused.isError,
      `another workspace's review is not found (${refused.text.slice(0, 60)})`
    );

    const compared = await callTool(plaintext, 'get_comparison', { comparisonId: comparison.id });
    if (process.env.SMOKE_MCP_SHOW) console.log(compared.text);
    const comparedDrafts = z
      .array(z.object({ assessmentId: z.string().nullable() }).loose())
      .safeParse(field(compared.data, 'drafts'));
    check(
      !compared.isError &&
        field(compared.data, 'id') === comparison.id &&
        field(compared.data, 'ready') === true &&
        comparedDrafts.success &&
        comparedDrafts.data.map((d) => d.assessmentId).join() === [review.id, second.id].join(),
      `get_comparison reads the workspace's comparison (${compared.isError ? compared.text : String(field(compared.data, 'status'))})`
    );
    check(
      String(field(compared.data, 'compareUrl')).endsWith(`/compare/${comparison.id}`),
      'and links its page'
    );
    const theirs = await callTool(plaintext, 'get_comparison', {
      comparisonId: theirComparison.id,
    });
    check(
      theirs.isError,
      `another workspace's comparison is not found (${theirs.text.slice(0, 60)})`
    );

    const rewritten = await callTool(plaintext, 'get_rewrite', { rewriteId: rewrite.id });
    if (process.env.SMOKE_MCP_SHOW) console.log(rewritten.text);
    const placeholders = z
      .array(z.object({ id: z.string(), label: z.string() }))
      .safeParse(field(rewritten.data, 'placeholders'));
    check(
      !rewritten.isError &&
        field(rewritten.data, 'id') === rewrite.id &&
        field(rewritten.data, 'draft') === REWRITTEN &&
        placeholders.success &&
        placeholders.data.map((p) => `${p.id}:${p.label}`).join() === 'p1:the hours saved',
      `get_rewrite reads the workspace's rewrite and its placeholder (${rewritten.isError ? rewritten.text : String(field(rewritten.data, 'status'))})`
    );
    check(
      String(field(rewritten.data, 'reviewUrl')).endsWith(`/assessments/${review.id}`),
      'and links its review'
    );
    const theirRewritten = await callTool(plaintext, 'get_rewrite', { rewriteId: theirRewrite.id });
    check(
      theirRewritten.isError,
      `another workspace's rewrite is not found (${theirRewritten.text.slice(0, 60)})`
    );
  } finally {
    // Each step on its own, so one that fails does not leave the rest undone.
    const cleanUp = async (what: string, step: () => Promise<unknown>) => {
      await system(step).catch((err: unknown) => {
        console.error(`  ✗ could not ${what} after the smoke:`, err);
        failures++;
      });
    };
    for (const ws of made) {
      await cleanUp('erase a smoke workspace', () =>
        eraseOrg({ orgId: ws.id, actorUserId: 'smoke' })
      );
    }
    await cleanUp('restore the MCP server switch', () =>
      prisma.mcpServerConfig.update({
        where: { id: config.id },
        data: { isEnabled: config.isEnabled },
      })
    );
    for (const c of capabilities) {
      const before = exposedBefore.find((e) => e.capabilityId === c.id);
      await cleanUp(`restore the ${c.slug} tool`, () =>
        before
          ? prisma.mcpExposedTool.update({
              where: { capabilityId: c.id },
              data: { isEnabled: before.isEnabled },
            })
          : prisma.mcpExposedTool.deleteMany({ where: { capabilityId: c.id } })
      );
    }
  }

  console.log(failures === 0 ? 'MCP tools smoke passed' : `${failures} check(s) failed`);
  return failures === 0 ? 0 : 1;
}

void main()
  .catch((err: unknown) => {
    console.error(err);
    return 1;
  })
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  });
