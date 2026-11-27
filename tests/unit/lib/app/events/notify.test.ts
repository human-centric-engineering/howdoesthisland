/**
 * Tests: a workspace's finished events (t-99), end to end through core's
 * real hook dispatcher: a review or comparison that ends is POSTed, signed,
 * to the subscriptions of its own workspace and of no other, exactly once,
 * and the outbox (`notifiedAt`) is what makes a lost send come back.
 *
 * Over the assessments' in-memory store (`fake-db.ts`), with core's two hook
 * tables added: `aiEventHook.findMany` answers the hooks of the org it is
 * called in (standing in for row isolation, as core's own tenancy test does),
 * and `aiEventHookDelivery` records the rows core writes. `fetch` is the
 * receiver. The signing, the matching and the delivery are core's, unmocked.
 *
 * @see lib/app/events/notify.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createFakeDb, type FakeDb, type Row } from '@/tests/unit/lib/app/assessments/fake-db';

const mocks = vi.hoisted(() => ({
  engineForVersion: vi.fn(),
  fetch: vi.fn(),
  deliveryCreate: vi.fn(),
}));

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    env: {
      ...actual.env,
      BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-characters-long',
    },
  };
});

let fake: FakeDb;
/** Each workspace's hooks, as the policies would show them to that workspace. */
let hooksByOrg: Record<string, Row[]> = {};

vi.mock('@/lib/db/client', () => ({
  get prisma() {
    return {
      ...fake.db,
      aiEventHook: {
        findMany: vi.fn(async () => {
          const { orgId } = requireTenantContext();
          return (orgId ? (hooksByOrg[orgId] ?? []) : []).filter((h) => h.isEnabled !== false);
        }),
      },
      aiEventHookDelivery: {
        create: mocks.deliveryCreate,
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
        updateManyAndReturn: vi.fn(async () => [{ id: 'del', createdAt: new Date() }]),
      },
    };
  },
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/app/assessments/engine', () => ({ engineForVersion: mocks.engineForVersion }));
vi.stubGlobal('fetch', mocks.fetch);

import {
  SWEEP_GRACE_MS,
  SWEEP_WINDOW_MS,
  notifyAfterReview,
  notifyAfterVerdict,
  sendAssessmentFinished,
  sendComparisonFinished,
  sweepFinishedEvents,
} from '@/lib/app/events/notify';
import { cancelAssessment } from '@/lib/app/assessments/run';
import { invalidateHookCache } from '@/lib/orchestration/hooks/registry';
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifyHookSignature,
} from '@/lib/orchestration/hooks/signing';
import { requireTenantContext, runAsOrg } from '@/lib/tenancy/context';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const SECRET_A = 'a'.repeat(64);
const SECRET_B = 'b'.repeat(64);

function hook(orgId: string, eventType: string, url: string, secret: string, filter?: Row): Row {
  return {
    id: `hook-${orgId}-${eventType}`,
    eventType,
    action: { type: 'webhook', url },
    filter: filter ?? null,
    secret,
    isEnabled: true,
  };
}

type Post = { url: string; body: string; headers: Record<string, string> };
const posts = (): Post[] =>
  mocks.fetch.mock.calls.map(
    ([url, init]: [string, { body: string; headers: Record<string, string> }]) => ({
      url: String(url),
      body: init.body,
      headers: init.headers,
    })
  );
const sentBody = z.object({ data: z.record(z.string(), z.unknown()) });
const dataOf = (post: Post): Row => sentBody.parse(JSON.parse(post.body)).data;
const settle = () => new Promise((r) => setTimeout(r, 30));

/** A review in `status`, ended long enough ago for the sweep to take it. */
function review(status: string, over: Row = {}): Row {
  const ended = !['QUEUED', 'RUNNING'].includes(status);
  return fake.seed({
    status,
    overall: ended && status !== 'FAILED' && status !== 'CANCELLED' ? 71 : null,
    band: ended && status !== 'FAILED' && status !== 'CANCELLED' ? 'strong' : null,
    projectId: null,
    completedAt: ended ? new Date(Date.now() - 10 * 60_000) : null,
    updatedAt: new Date(Date.now() - 10 * 60_000),
    notifiedAt: null,
    ...over,
  });
}

function comparison(reviews: Row[], over: Row = {}): Row {
  const set: Row = {
    id: `set-${fake.sets.length + 1}`,
    orgId: ORG_A,
    kind: 'COMPARISON',
    projectId: null,
    frameworkVersionId: 'version-1',
    profile: 'full',
    judges: ['judge_ethos', 'judge_pathos'],
    context: { contentType: 'landing_page' },
    createdByUserId: 'user-1',
    createdAt: new Date(Date.now() - 20 * 60_000),
    updatedAt: new Date(Date.now() - 10 * 60_000),
    verdictStatus: 'COMPLETED',
    verdict: { draft: 1, why: 'Because.', appeals: [] },
    verdictReason: null,
    verdictHeldUsd: 0,
    verdictCostUsd: 0,
    verdictModel: 'gpt-5',
    verdictAttempts: 1,
    verdictLeaseExpiresAt: null,
    verdictCompletedAt: new Date(Date.now() - 10 * 60_000),
    notifiedAt: null,
    ...over,
  };
  fake.sets.push(set);
  reviews.forEach((r, position) =>
    fake.setMembers.push({
      id: `member-${String(set.id)}-${position}`,
      orgId: ORG_A,
      setId: set.id,
      assessmentId: r.id,
      position,
      label: `Secret subject line ${position + 1}`,
    })
  );
  return set;
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateHookCache();
  fake = createFakeDb();
  hooksByOrg = {
    [ORG_A]: [
      hook(ORG_A, 'app.assessment.finished', 'https://a.example.com/reviews', SECRET_A),
      hook(ORG_A, 'app.comparison.finished', 'https://a.example.com/comparisons', SECRET_A),
    ],
    [ORG_B]: [hook(ORG_B, 'app.assessment.finished', 'https://b.example.com/reviews', SECRET_B)],
  };
  mocks.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
  mocks.deliveryCreate.mockImplementation(async ({ data }: { data: Row }) => ({
    id: `del-${mocks.deliveryCreate.mock.calls.length}`,
    createdAt: new Date(),
    attempts: 0,
    ...data,
  }));
  mocks.engineForVersion.mockResolvedValue({ engine: { appealScores: () => null } });
});

describe('a finished review', () => {
  it('is POSTed once, signed with its own workspace’s secret, to its own workspace only', async () => {
    const row = review('COMPLETED');

    await runAsOrg(ORG_A, () => sendAssessmentFinished(String(row.id)));
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    await settle();

    const [post] = posts();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(post?.url).toBe('https://a.example.com/reviews');
    expect(
      verifyHookSignature(
        SECRET_A,
        post.body,
        post.headers[TIMESTAMP_HEADER],
        post.headers[SIGNATURE_HEADER]
      )
    ).toEqual({ valid: true });
    expect(
      verifyHookSignature(
        SECRET_B,
        post.body,
        post.headers[TIMESTAMP_HEADER],
        post.headers[SIGNATURE_HEADER]
      )
    ).toMatchObject({ valid: false });
    expect(dataOf(post)).toEqual({
      eventId: `assessment:${String(row.id)}`,
      assessmentId: row.id,
      status: 'completed',
      overall: 71,
      band: 'strong',
      projectId: null,
      completedAt: z.date().parse(row.completedAt).toISOString(),
    });
    expect(row.notifiedAt).toBeInstanceOf(Date);
  });

  it('says nothing a deletion or an erasure would have to reach: no text, no user', async () => {
    const row = review('COMPLETED');
    const content = fake.contents.find((c) => c.id === row.contentId);
    if (content) content.text = 'The confidential launch copy';

    await runAsOrg(ORG_A, () => sendAssessmentFinished(String(row.id)));
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));

    const body = posts()[0].body;
    expect(body).not.toContain('confidential launch copy');
    expect(body).not.toContain('user-1');
    expect(Object.keys(dataOf(posts()[0]))).not.toContain('userId');
  });

  it.each([
    ['PARTIAL', 'partial'],
    ['FAILED', 'failed'],
    ['CANCELLED', 'cancelled'],
  ])('is sent when it ends %s, with that state', async (status, state) => {
    const row = review(status);
    await runAsOrg(ORG_A, () => sendAssessmentFinished(String(row.id)));
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    expect(dataOf(posts()[0]).status).toBe(state);
  });

  it.each(['QUEUED', 'RUNNING'])('is not sent while %s, and stays unsent', async (status) => {
    const row = review(status);
    expect(await runAsOrg(ORG_A, () => sendAssessmentFinished(String(row.id)))).toBe(false);
    await settle();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(row.notifiedAt).toBeNull();
  });

  it('is sent once: a second send of the same review sends nothing', async () => {
    const row = review('COMPLETED');
    await runAsOrg(ORG_A, () => sendAssessmentFinished(String(row.id)));
    expect(await runAsOrg(ORG_A, () => sendAssessmentFinished(String(row.id)))).toBe(false);
    await settle();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('is not sent to a subscription filtered to another project', async () => {
    hooksByOrg[ORG_A] = [
      hook(ORG_A, 'app.assessment.finished', 'https://a.example.com/p1', SECRET_A, {
        projectId: 'project-1',
      }),
      hook(ORG_A, 'app.assessment.finished', 'https://a.example.com/p2', SECRET_A, {
        projectId: 'project-2',
      }),
    ];
    const row = review('COMPLETED', { projectId: 'project-2' });
    await runAsOrg(ORG_A, () => sendAssessmentFinished(String(row.id)));
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    await settle();
    expect(posts().map((p) => p.url)).toEqual(['https://a.example.com/p2']);
  });

  it('is left unsent when core cannot queue it, and the sweep sends it later', async () => {
    const row = review('COMPLETED');
    mocks.deliveryCreate.mockRejectedValueOnce(new Error('database away'));

    await expect(runAsOrg(ORG_A, () => sendAssessmentFinished(String(row.id)))).rejects.toThrow(
      /not queued/
    );
    expect(row.notifiedAt).toBeNull();

    const swept = await runAsOrg(ORG_A, () => sweepFinishedEvents());
    expect(swept).toEqual({ assessments: 1, comparisons: 0, failed: 0 });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    expect(row.notifiedAt).toBeInstanceOf(Date);
  });
});

describe('the end of a review, wired', () => {
  it('cancelling a queued review sends its cancelled event once, in its workspace', async () => {
    const row = review('QUEUED', { updatedAt: new Date() });
    await runAsOrg(ORG_A, () => cancelAssessment(String(row.id)));
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    await settle();
    expect(posts().map((p) => p.url)).toEqual(['https://a.example.com/reviews']);
    expect(dataOf(posts()[0]).status).toBe('cancelled');
    expect(row.notifiedAt).toBeInstanceOf(Date);
  });

  it('the last draft of a comparison with no verdict to wait for sends both events', async () => {
    const first = review('COMPLETED', { notifiedAt: new Date() });
    const last = review('COMPLETED');
    const set = comparison([first, last], {
      verdictStatus: 'SKIPPED',
      verdict: null,
      verdictReason: 'too_few_judges',
    });

    await runAsOrg(ORG_A, async () => notifyAfterReview(ORG_A, String(last.id)));
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    await settle();

    expect(
      posts()
        .map((p) => p.url)
        .sort()
    ).toEqual(['https://a.example.com/comparisons', 'https://a.example.com/reviews']);
    expect(set.notifiedAt).toBeInstanceOf(Date);
  });
});

describe('a comparison’s sweep clock', () => {
  it('runs from its last draft’s end, not from when it was made', async () => {
    const made = new Date(Date.now() - 3 * 86_400_000);
    const draft = review('QUEUED');
    const set = comparison([review('COMPLETED', { notifiedAt: new Date() }), draft], {
      verdictStatus: 'SKIPPED',
      verdict: null,
      updatedAt: made,
    });
    await runAsOrg(ORG_A, async () => notifyAfterReview(ORG_A, String(draft.id)));
    await vi.waitFor(() =>
      expect(z.date().parse(set.updatedAt).getTime()).toBeGreaterThan(made.getTime())
    );
  });
});

describe('a finished comparison', () => {
  it('is sent with each draft’s state and scores and the verdict, and no draft label', async () => {
    const a = review('COMPLETED');
    const b = review('FAILED');
    const set = comparison([a, b], {
      verdictStatus: 'SKIPPED',
      verdict: null,
      verdictReason: 'too_few_completed',
    });

    await runAsOrg(ORG_A, () => sendComparisonFinished(String(set.id)));
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));

    const [post] = posts();
    expect(post?.url).toBe('https://a.example.com/comparisons');
    expect(dataOf(post)).toEqual({
      eventId: `comparison:${String(set.id)}`,
      comparisonId: set.id,
      status: 'failed',
      projectId: null,
      verdict: { status: 'skipped', draft: null },
      drafts: [
        { position: 0, assessmentId: a.id, status: 'completed', overall: 71, band: 'strong' },
        { position: 1, assessmentId: b.id, status: 'failed', overall: null, band: null },
      ],
    });
    expect(post.body).not.toContain('Secret subject line');
  });

  it('is not sent while a draft runs, nor while its verdict is still to come', async () => {
    const running = comparison([review('COMPLETED'), review('RUNNING')], {
      verdictStatus: 'SKIPPED',
    });
    const waiting = comparison([review('COMPLETED'), review('COMPLETED')], {
      verdictStatus: 'WAITING',
      verdict: null,
    });
    expect(await runAsOrg(ORG_A, () => sendComparisonFinished(String(running.id)))).toBe(false);
    expect(await runAsOrg(ORG_A, () => sendComparisonFinished(String(waiting.id)))).toBe(false);
    await settle();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(running.notifiedAt).toBeNull();
    expect(waiting.notifiedAt).toBeNull();
  });
});

describe('the sweep', () => {
  it('sends only what is owed: not history already marked sent, not what just ended', async () => {
    // History the migration marked sent, beside one unsent row of each kind.
    for (let i = 0; i < 3; i += 1)
      review('COMPLETED', { notifiedAt: new Date(Date.now() - 86_400_000) });
    const history = comparison([review('COMPLETED', { notifiedAt: new Date() })], {
      notifiedAt: new Date(Date.now() - 86_400_000),
    });
    const justEnded = review('COMPLETED', { updatedAt: new Date(Date.now() - SWEEP_GRACE_MS / 2) });
    const owed = review('PARTIAL');
    const owedSet = comparison([review('COMPLETED', { notifiedAt: new Date() })]);

    const swept = await runAsOrg(ORG_A, () => sweepFinishedEvents());
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    await settle();

    expect(swept).toEqual({ assessments: 1, comparisons: 1, failed: 0 });
    expect(
      posts()
        .map((p) => dataOf(p).eventId)
        .sort()
    ).toEqual([`assessment:${String(owed.id)}`, `comparison:${String(owedSet.id)}`]);
    expect(justEnded.notifiedAt).toBeNull();
    expect(history.notifiedAt).not.toBeNull();
  });

  it('passes over a comparison whose drafts still run, though its verdict was skipped at the start', async () => {
    const inFlight = comparison(
      [review('COMPLETED', { notifiedAt: new Date() }), review('QUEUED')],
      {
        verdictStatus: 'SKIPPED',
        verdict: null,
        verdictReason: 'too_few_judges',
      }
    );
    const swept = await runAsOrg(ORG_A, () => sweepFinishedEvents());
    expect(swept.comparisons).toBe(0);
    expect(inFlight.notifiedAt).toBeNull();
    expect(mocks.engineForVersion).not.toHaveBeenCalled();
  });

  it('gives up on a row that ended more than a day ago, and takes the newest first', async () => {
    const stale = review('COMPLETED', {
      updatedAt: new Date(Date.now() - SWEEP_WINDOW_MS - 60_000),
    });
    const fresh = review('COMPLETED');
    const swept = await runAsOrg(ORG_A, () => sweepFinishedEvents());
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    expect(swept.assessments).toBe(1);
    expect(fresh.notifiedAt).toBeInstanceOf(Date);
    expect(stale.notifiedAt).toBeNull();
    expect(fake.db.assessment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: 'desc' } })
    );
  });

  it('touches only its own workspace’s rows', async () => {
    const other = review('COMPLETED', { orgId: ORG_B });
    const swept = await runAsOrg(ORG_A, () => sweepFinishedEvents());
    await settle();
    expect(swept).toEqual({ assessments: 0, comparisons: 0, failed: 0 });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(other.notifiedAt).toBeNull();
  });
});

describe('when a send fails', () => {
  it('notifyAfterReview logs and goes on to the comparison when the review’s send fails', async () => {
    const first = review('COMPLETED', { notifiedAt: new Date() });
    const last = review('COMPLETED');
    const set = comparison([first, last], { verdictStatus: 'SKIPPED', verdict: null });
    // The review's delivery row fails; the comparison's succeeds.
    mocks.deliveryCreate.mockRejectedValueOnce(new Error('database away'));

    await runAsOrg(ORG_A, async () => notifyAfterReview(ORG_A, String(last.id)));
    await vi.waitFor(() => expect(set.notifiedAt).toBeInstanceOf(Date));
    expect(last.notifiedAt).toBeNull();
  });

  it('notifyAfterVerdict leaves a comparison it could not queue for the sweep', async () => {
    const set = comparison([review('COMPLETED', { notifiedAt: new Date() })]);
    mocks.deliveryCreate.mockRejectedValueOnce(new Error('database away'));
    await runAsOrg(ORG_A, async () => notifyAfterVerdict(String(set.id)));
    await settle();
    expect(set.notifiedAt).toBeNull();
  });

  it('the sweep counts what it could not queue and leaves it owed', async () => {
    const owed = review('FAILED', { completedAt: null });
    const owedSet = comparison([review('COMPLETED', { notifiedAt: new Date() })]);
    mocks.deliveryCreate.mockRejectedValue(new Error('database away'));
    const swept = await runAsOrg(ORG_A, () => sweepFinishedEvents());
    expect(swept).toEqual({ assessments: 0, comparisons: 0, failed: 2 });
    expect(owed.notifiedAt).toBeNull();
    expect(owedSet.notifiedAt).toBeNull();
  });

  it('a review with no completion time is sent with completedAt null', async () => {
    const row = review('FAILED', { completedAt: null });
    await runAsOrg(ORG_A, () => sendAssessmentFinished(String(row.id)));
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    expect(dataOf(posts()[0]).completedAt).toBeNull();
  });

  it('a comparison already sent, or gone, sends nothing', async () => {
    const sent = comparison([review('COMPLETED', { notifiedAt: new Date() })], {
      notifiedAt: new Date(),
    });
    expect(await runAsOrg(ORG_A, () => sendComparisonFinished(String(sent.id)))).toBe(false);
    expect(await runAsOrg(ORG_A, () => sendComparisonFinished('set-none'))).toBe(false);
  });
});
