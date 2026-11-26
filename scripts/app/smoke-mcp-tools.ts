/**
 * Smoke: HowDoesThisLand's MCP tools through the real transport (t-92).
 *
 * What no unit test can prove: that a key bound to a workspace reaches the
 * tools through `POST /api/v1/mcp` on a running server, which registers the
 * app's capabilities in the route-handler realm, runs the call inside the
 * key's workspace with its creator as the person, and answers through the
 * dispatcher's whole pipeline against the real database and row-level
 * security.
 *
 * Makes a throwaway workspace with one finished review (scored by the quick
 * scan, so no judge is called and nothing is billed) and an MCP key in it,
 * switches the MCP server and the three tools on if they are off, then:
 * `tools/list`, `quick_scan`, `get_assessment` on the workspace's review, and
 * `get_assessment` on another workspace's. Puts the switches back and erases
 * the workspace, key and all, at the end. `assess_draft` is not called: it
 * would run the judges, which cost money.
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

  const stamp = Date.now();
  const org = await system(() => createWorkspaceOrg('Smoke MCP tools', `smoke-mcp-${stamp}`));
  const other = await system(() =>
    createWorkspaceOrg('Smoke MCP tools (other)', `smoke-mcp-other-${stamp}`)
  );
  try {
    const scan = await runAsOrg(org.id, () => runQuickScan({ text: DRAFT }));
    const makeReview = (orgId: string) =>
      runAsOrg(orgId, async () => {
        const content = await prisma.content.create({
          data: {
            orgId,
            sourceKind: 'TEXT',
            text: DRAFT,
            textSha256: `smoke-mcp-${stamp}`,
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
    const review = await makeReview(org.id);
    const elsewhere = await makeReview(other.id);

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
  } finally {
    await system(async () => {
      await eraseOrg({ orgId: org.id, actorUserId: 'smoke' });
      await eraseOrg({ orgId: other.id, actorUserId: 'smoke' });
      await prisma.mcpServerConfig.update({
        where: { id: config.id },
        data: { isEnabled: config.isEnabled },
      });
      for (const c of capabilities) {
        const before = exposedBefore.find((e) => e.capabilityId === c.id);
        if (before) {
          await prisma.mcpExposedTool.update({
            where: { capabilityId: c.id },
            data: { isEnabled: before.isEnabled },
          });
        } else {
          await prisma.mcpExposedTool.delete({ where: { capabilityId: c.id } });
        }
      }
    }).catch((err: unknown) => {
      console.error('  ✗ could not clean up after the smoke:', err);
      failures++;
    });
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
