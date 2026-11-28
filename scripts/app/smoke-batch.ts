/**
 * Smoke: a batch of more items than the workspace's running places, against
 * the real database (t-101). Free: the `quick` profile calls no model.
 *
 *   npm run smoke:batch
 *
 * What the unit tests cannot show, because their fakes stand in for Prisma:
 * that Postgres stores a page's content with no text, and the
 * `app_content_text_pending_fetch` constraint allows that for a page alone
 * and refuses it for pasted text; that the run writes the fetched text into
 * that row under its lease; that the real claim's serializable count lets
 * three run at once and the rest start as places free, until every item is
 * final; and that the batch's finished event is stamped through core's real
 * outbox (a workspace with no subscription stamps at once).
 *
 * In a fresh workspace: five pasted texts, a page that cannot be fetched
 * (`.invalid` never resolves), and `https://example.com/`, which needs the
 * network. Self-cleaning: the workspace (and with it its rows) is erased in
 * `finally`.
 *
 * Exit 0 passed, 1 a check failed.
 */
import { prisma } from '@/lib/db/client';
import { eraseOrg } from '@/lib/privacy/erase-org';
import { runAsOrg, runAsSystem } from '@/lib/tenancy/context';
import { createWorkspaceOrg } from '@/lib/app/workspaces/provision';
import { createBatch, prepareBatch } from '@/lib/app/batches/service';
import { readBatch } from '@/lib/app/batches/views';
import { createBatchSchema } from '@/lib/app/batches/validations';
import { RUNNING_PER_WORKSPACE } from '@/lib/app/assessments/limits';

let failures = 0;

function check(ok: boolean, what: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures++;
}

const system = <T>(fn: () => Promise<T>) => runAsSystem('smoke: batch', fn);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const OWNER_EMAIL = process.env.SMOKE_BATCH_USER_EMAIL ?? 'report-check@example.test';
const TEXTS = [
  'Book a demo this week and cut onboarding to two days.',
  'Teams like yours onboard in two days. See how in a demo.',
  'Onboarding takes two weeks. It does not have to.',
  'Two days, not two weeks: book a demo.',
  'Your team, onboarded by Friday.',
];
const UNREACHABLE = 'https://batch-smoke.invalid/page';
const REACHABLE = 'https://example.com/';

async function main(): Promise<number> {
  const user = await system(() =>
    prisma.user.findUnique({ where: { email: OWNER_EMAIL }, select: { id: true } })
  );
  if (!user) {
    console.log(`  ✗ no user ${OWNER_EMAIL}; set SMOKE_BATCH_USER_EMAIL`);
    return 1;
  }
  const stamp = Date.now();
  const org = await system(() => createWorkspaceOrg('Smoke batch', `smoke-batch-${stamp}`));
  try {
    await runAsOrg(org.id, async () => {
      const body = createBatchSchema.parse({
        profile: 'quick',
        items: [
          ...TEXTS.map((text, i) => ({ text, label: `Text ${i + 1}` })),
          { url: UNREACHABLE, label: 'Unreachable' },
          { url: REACHABLE },
        ],
      });
      check(body.items.length > RUNNING_PER_WORKSPACE, `${body.items.length} items, 3 places`);
      const prepared = await prepareBatch(body);
      const created = await createBatch(body, prepared, { userId: user.id, apiKeyId: null });

      const pages = await prisma.content.findMany({
        where: { orgId: org.id, sourceKind: 'URL' },
        select: { sourceUrl: true, text: true },
      });
      check(pages.length === 2, 'both pages stored as pages');

      // The constraint: no text is allowed for a page alone.
      const refused = await prisma.content
        .create({
          data: {
            orgId: org.id,
            sourceKind: 'TEXT',
            text: null,
            textSha256: null,
            wordCount: null,
          },
        })
        .then(
          () => false,
          (err: unknown) => String(err).includes('app_content_text_pending_fetch')
        );
      check(refused, 'pasted text with no text is refused by the constraint');

      let batch = created;
      const deadline = Date.now() + 60_000;
      while (batch.status === 'running' && Date.now() < deadline) {
        await sleep(500);
        batch = (await readBatch(created.id)) ?? batch;
      }
      check(batch.status !== 'running', `every item ended (${batch.status})`);
      check(batch.counts.completed === 6, `six completed (${batch.counts.completed})`);
      const unreachable = batch.items[5];
      check(
        unreachable.status === 'failed' && unreachable.errorCode === 'FETCH_FAILED',
        `the unreachable page failed alone (${unreachable.status}, ${unreachable.errorCode})`
      );
      const fetched = await prisma.content.findFirst({
        where: { orgId: org.id, sourceKind: 'URL', text: { not: null } },
        select: { text: true, wordCount: true, textSha256: true, title: true },
      });
      check(
        fetched !== null && (fetched.wordCount ?? 0) > 0 && fetched.textSha256 !== null,
        `the reachable page's text was written by its run (${fetched?.wordCount ?? 0} words, "${fetched?.title ?? ''}")`
      );
      const left = await prisma.content.count({
        where: { orgId: org.id, text: null, sourceUrl: UNREACHABLE },
      });
      check(left === 1, 'the unreachable page keeps no text');

      // The finished event goes from the last run's end, after it.
      let set = null;
      for (let i = 0; i < 20 && !set?.notifiedAt; i += 1) {
        set = await prisma.assessmentSet.findUnique({
          where: { id: created.id },
          select: { verdictStatus: true, verdictReason: true, notifiedAt: true },
        });
        if (!set?.notifiedAt) await sleep(250);
      }
      check(
        set?.verdictStatus === 'SKIPPED' && set.verdictReason === 'not_asked',
        'born with its verdict settled, and never asked'
      );
      check(Boolean(set?.notifiedAt), 'its finished event was stamped');
    });
  } finally {
    await system(() => eraseOrg({ orgId: org.id, actorUserId: 'smoke' })).catch((err: unknown) => {
      console.error(`  ✗ could not clean up the smoke workspace ${org.id}:`, err);
      failures++;
    });
  }

  console.log(failures === 0 ? 'Batch smoke passed' : `${failures} check(s) failed`);
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
