/**
 * The comparison MCP tools of t-93 around the library they share with the
 * comparisons route.
 *
 * The library is mocked: these pin what each tool adds, which is the person
 * behind the key, the route's order of steps and its per-person cap, the
 * holds released however a call ends, the bound, and what the audit trail
 * keeps. That the library itself charges and runs is the route's tests'.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepareComparison: vi.fn(),
  holdComparisonBudget: vi.fn(),
  createComparison: vi.fn(),
  releaseHolds: vi.fn(),
  getComparison: vi.fn(),
  peek: vi.fn(),
  check: vi.fn(),
  findUnique: vi.fn(),
  verifiedMembership: vi.fn(),
  requireOrgId: vi.fn(),
}));

vi.mock('@/lib/app/comparisons/service', () => ({
  prepareComparison: mocks.prepareComparison,
  holdComparisonBudget: mocks.holdComparisonBudget,
  createComparison: mocks.createComparison,
  releaseHolds: mocks.releaseHolds,
  getComparison: mocks.getComparison,
}));
vi.mock('@/lib/app/assessments/api/limiter', () => ({
  aiAssessmentLimiter: { peek: mocks.peek, check: mocks.check },
}));
vi.mock('@/lib/tenancy/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/context')>()),
  requireOrgId: mocks.requireOrgId,
}));
vi.mock('@/lib/db/client', () => ({
  prisma: { assessmentSet: { findUnique: mocks.findUnique } },
}));
vi.mock('@/lib/tenancy/entry', () => ({ verifiedMembership: mocks.verifiedMembership }));

import { APIError, NotFoundError } from '@/lib/api/errors';
import type { ComparisonDetail } from '@/lib/app/comparisons/views';
import { CompareDraftsCapability } from '@/lib/app/mcp/compare-drafts';
import { GetComparisonCapability } from '@/lib/app/mcp/get-comparison';
import { MCP_WAIT_MS } from '@/lib/app/mcp/tool-support';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

const asCreator: CapabilityContext = { userId: 'user-1', agentId: 'mcp-system' };
const noCreator: CapabilityContext = { userId: null, agentId: 'mcp-system' };

const OPENING_A = 'Sarah at Acme saved four hours a week.';
const OPENING_B = 'Teams like yours save four hours a week.';
const ARGS = {
  drafts: [
    { text: OPENING_A, label: 'Sarah' },
    { text: OPENING_B, label: 'Teams' },
  ],
};

/** A comparison as `readComparison` answers it, in `status` with its verdict in `verdict`. */
function detail(
  status: ComparisonDetail['status'],
  verdict: ComparisonDetail['verdict']['status']
): ComparisonDetail {
  return {
    id: 'cmp-1',
    kind: 'comparison',
    status,
    framework: { slug: 'howdoesthisland', version: '1.0.0' },
    profile: 'full',
    judges: ['ethos', 'logos'],
    projectId: null,
    project: null,
    createdAt: new Date('2026-11-26T10:00:00Z'),
    context: { contentType: 'general' },
    drafts: [
      {
        position: 0,
        label: 'Sarah',
        assessmentId: 'a-1',
        status: 'completed',
        overall: 71,
        band: 'Strong',
        appeals: [],
      },
      {
        position: 1,
        label: 'Teams',
        assessmentId: 'a-2',
        status: status === 'running' ? 'running' : 'completed',
        overall: status === 'running' ? null : 58,
        band: status === 'running' ? null : 'Fair',
        appeals: [],
      },
    ],
    appeals: [],
    verdict: {
      status: verdict,
      draft: verdict === 'completed' ? 0 : null,
      why: verdict === 'completed' ? 'A named person is easier to believe.' : null,
      appeals: [],
      reason: null,
      model: 'm',
      costUsd: 0.01,
      completedAt: null,
    },
  };
}

/** The light row the wait polls: each draft's review status and the verdict's. */
const row = (statuses: string[], verdictStatus: string) => ({
  verdictStatus,
  members: statuses.map((status) => ({ assessment: { status } })),
});

beforeEach(() => {
  mocks.requireOrgId.mockReturnValue('org-1');
  mocks.verifiedMembership.mockResolvedValue({ role: 'MEMBER' });
  mocks.prepareComparison.mockResolvedValue({ judges: ['ethos', 'logos'], toReview: 2, holds: [] });
  mocks.holdComparisonBudget.mockResolvedValue(undefined);
  mocks.releaseHolds.mockResolvedValue(undefined);
  mocks.peek.mockReturnValue({ success: true, limit: 5, remaining: 5, reset: 0 });
  mocks.createComparison.mockImplementation(async (_b, _p, _c, options) => {
    options?.onStored?.('cmp-1');
    return detail('running', 'waiting');
  });
  mocks.findUnique.mockResolvedValue(row(['COMPLETED', 'COMPLETED'], 'COMPLETED'));
  mocks.getComparison.mockResolvedValue(detail('completed', 'completed'));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('compare_drafts', () => {
  const tool = new CompareDraftsCapability();

  it('takes the route’s steps in its order, as the key’s creator, recorded as MCP', async () => {
    const order: string[] = [];
    mocks.prepareComparison.mockImplementation(async () => {
      order.push('prepare');
      return { judges: ['ethos'], toReview: 2, holds: [] };
    });
    mocks.peek.mockImplementation(() => {
      order.push('peek');
      return { success: true, limit: 5, remaining: 5, reset: 0 };
    });
    mocks.holdComparisonBudget.mockImplementation(async () => void order.push('hold'));
    mocks.check.mockImplementation(() => void order.push('count'));
    mocks.createComparison.mockImplementation(async (_b, _p, _c, options) => {
      order.push('create');
      options.onStored('cmp-1');
      return detail('running', 'waiting');
    });
    mocks.releaseHolds.mockImplementation(async () => void order.push('release'));

    const result = await tool.execute(tool.validate(ARGS), asCreator);

    expect(order).toEqual([
      'prepare',
      'peek',
      'hold',
      'peek',
      'count',
      'count',
      'create',
      'release',
    ]);
    expect(mocks.peek).toHaveBeenCalledWith('user:user-1');
    expect(mocks.verifiedMembership).toHaveBeenCalledWith('user-1', 'org-1', expect.anything());
    expect(mocks.createComparison).toHaveBeenCalledWith(
      ARGS,
      expect.anything(),
      { userId: 'user-1', apiKeyId: null, via: 'MCP' },
      expect.anything()
    );
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      id: 'cmp-1',
      status: 'completed',
      ready: true,
      next: null,
      verdict: { status: 'completed', draft: 0, why: 'A named person is easier to believe.' },
    });
  });

  it('refuses a key with no creator before loading anything', async () => {
    const result = await tool.execute(tool.validate(ARGS), noCreator);

    expect(result).toEqual({
      success: false,
      error: { code: 'KEY_HAS_NO_OWNER', message: expect.any(String) },
    });
    expect(mocks.prepareComparison).not.toHaveBeenCalled();
  });

  it('refuses a creator no longer in the workspace before preparing anything', async () => {
    mocks.verifiedMembership.mockResolvedValue({ refused: 'not-a-member' });

    const result = await tool.execute(tool.validate(ARGS), asCreator);

    expect(result.error?.code).toBe('KEY_HAS_NO_OWNER');
    expect(mocks.prepareComparison).not.toHaveBeenCalled();
  });

  it('refuses a suspended workspace as WORKSPACE_SUSPENDED', async () => {
    mocks.verifiedMembership.mockResolvedValue({ refused: 'org-suspended' });

    const result = await tool.execute(tool.validate(ARGS), asCreator);

    expect(result.error?.code).toBe('WORKSPACE_SUSPENDED');
    expect(mocks.prepareComparison).not.toHaveBeenCalled();
  });

  it('refuses at the cap before holding or counting anything, when there is no room for every draft', async () => {
    mocks.peek.mockReturnValue({ success: true, limit: 5, remaining: 1, reset: 0 });

    const result = await tool.execute(tool.validate(ARGS), asCreator);

    expect(result.error?.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(mocks.holdComparisonBudget).not.toHaveBeenCalled();
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.createComparison).not.toHaveBeenCalled();
  });

  it('refuses room taken during the hold, counts nothing and releases the holds', async () => {
    mocks.peek
      .mockReturnValueOnce({ success: true, limit: 5, remaining: 2, reset: 0 })
      .mockReturnValueOnce({ success: true, limit: 5, remaining: 1, reset: 0 });

    const result = await tool.execute(tool.validate(ARGS), asCreator);

    expect(result.error?.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(mocks.holdComparisonBudget).toHaveBeenCalledTimes(1);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.createComparison).not.toHaveBeenCalled();
    expect(mocks.releaseHolds).toHaveBeenCalledTimes(1);
  });

  it('counts only the drafts it reviews, not a review it reuses', async () => {
    mocks.prepareComparison.mockResolvedValue({ judges: ['ethos'], toReview: 1, holds: [] });
    mocks.peek.mockReturnValue({ success: true, limit: 5, remaining: 1, reset: 0 });

    const result = await tool.execute(
      tool.validate({ drafts: [{ text: OPENING_A }, { assessmentId: 'a-0' }] }),
      asCreator
    );

    expect(result.success).toBe(true);
    expect(mocks.check).toHaveBeenCalledTimes(1);
  });

  it('neither caps nor holds a set no AI reviewer reads', async () => {
    mocks.prepareComparison.mockResolvedValue({ judges: [], toReview: 2, holds: [] });

    await tool.execute(tool.validate(ARGS), asCreator);

    expect(mocks.peek).not.toHaveBeenCalled();
    expect(mocks.holdComparisonBudget).not.toHaveBeenCalled();
    expect(mocks.createComparison).toHaveBeenCalled();
  });

  it('releases the holds and answers the library’s refusal when the write fails', async () => {
    mocks.createComparison.mockRejectedValue(
      new APIError('That review has not finished yet.', 'REVIEW_NOT_COMPARABLE', 409, {
        position: 1,
      })
    );

    const result = await tool.execute(tool.validate(ARGS), asCreator);

    expect(result).toEqual({
      success: false,
      error: {
        code: 'REVIEW_NOT_COMPARABLE',
        message: 'The draft at position 1: That review has not finished yet.',
      },
    });
    expect(mocks.releaseHolds).toHaveBeenCalledTimes(1);
  });

  it('answers the budget’s refusal with nothing created', async () => {
    mocks.holdComparisonBudget.mockRejectedValue(
      new APIError('This comparison would cost about 2 credits.', 'INSUFFICIENT_CREDITS', 402)
    );

    const result = await tool.execute(tool.validate(ARGS), asCreator);

    expect(result.error?.code).toBe('INSUFFICIENT_CREDITS');
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.createComparison).not.toHaveBeenCalled();
    expect(mocks.releaseHolds).toHaveBeenCalledTimes(1);
  });

  it('lets an unexpected failure before storing through, for the dispatcher to log', async () => {
    mocks.prepareComparison.mockRejectedValue(new Error('engine missing'));

    await expect(tool.execute(tool.validate(ARGS), asCreator)).rejects.toThrow('engine missing');
  });

  it('answers the stored id, never a bare failure, when the read after storing fails', async () => {
    mocks.getComparison.mockRejectedValue(new Error('connection reset'));

    const result = await tool.execute(tool.validate(ARGS), asCreator);

    expect(result.error?.code).toBe('STORED_UNREAD');
    expect(result.error?.message).toContain('cmp-1');
  });

  it('answers the stored id when the library fails after its write', async () => {
    mocks.createComparison.mockImplementation(async (_b, _p, _c, options) => {
      options.onStored('cmp-1');
      throw new Error('read after write');
    });

    const result = await tool.execute(tool.validate(ARGS), asCreator);

    expect(result.error?.code).toBe('STORED_UNREAD');
    expect(result.error?.message).toContain('get_comparison');
  });

  it('waits while the drafts run and answers once the verdict is in', async () => {
    vi.useFakeTimers();
    mocks.findUnique
      .mockResolvedValueOnce(row(['COMPLETED', 'RUNNING'], 'WAITING'))
      .mockResolvedValueOnce(row(['COMPLETED', 'COMPLETED'], 'RUNNING'))
      .mockResolvedValue(row(['COMPLETED', 'COMPLETED'], 'COMPLETED'));

    const pending = tool.execute(tool.validate(ARGS), asCreator);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;

    expect(mocks.findUnique).toHaveBeenCalledTimes(3);
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cmp-1', orgId: 'org-1', kind: 'COMPARISON' } })
    );
    expect(result.data?.ready).toBe(true);
  });

  it('answers the id and status once the bound has passed, and the comparison runs on', async () => {
    vi.useFakeTimers();
    mocks.findUnique.mockResolvedValue(row(['RUNNING', 'QUEUED'], 'WAITING'));
    mocks.getComparison.mockResolvedValue(detail('running', 'waiting'));

    let settled = false;
    const pending = tool.execute(tool.validate(ARGS), asCreator).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(MCP_WAIT_MS - 1_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;

    expect(result.data).toMatchObject({ id: 'cmp-1', status: 'running', ready: false });
    expect(result.data?.next).toContain('get_comparison');
  });

  it('keeps each draft’s length or review in the audit trail, never its words or label', () => {
    const redacted = tool.redactProvenance(
      tool.validate({
        drafts: [{ text: OPENING_A, label: 'Sarah' }, { assessmentId: 'a-0' }],
        context: { contentType: 'landing_page', reader: 'Jane Doe' },
      }),
      { success: true, data: { id: 'cmp-1', status: 'running' } as never }
    );

    expect(redacted.args).toEqual({
      drafts: [{ textChars: OPENING_A.length, label: '[label]' }, { assessmentId: 'a-0' }],
      projectId: undefined,
      context: { contentType: 'landing_page', reader: '[value]' },
    });
    expect(redacted.resultPreview).toBe(JSON.stringify({ id: 'cmp-1', status: 'running' }));
    expect(JSON.stringify(redacted)).not.toMatch(/Sarah|Jane/);
  });

  it('records the trace of arguments as a model sent them, whatever their shape', () => {
    const preview = (sent: unknown) =>
      tool.redactProvenance(sent as never, {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'no' },
      }).args;

    expect(preview({ drafts: 'Sarah vs Teams' })).toEqual({
      drafts: undefined,
      projectId: undefined,
      context: undefined,
    });
    expect(preview(undefined)).toEqual({
      drafts: undefined,
      projectId: undefined,
      context: undefined,
    });
    expect(
      preview({
        drafts: [null, 'Sarah', { text: 7, label: 'Sarah' }, { assessmentId: 'Sarah at Acme' }],
        projectId: 'Jane Doe, recently bereaved',
      })
    ).toEqual({
      drafts: [
        { draft: '[value]' },
        { draft: '[value]' },
        { label: '[label]' },
        { assessmentId: '[value]' },
      ],
      projectId: '[value]',
      context: undefined,
    });
  });

  it('answers a comparison deleted while it ran as not found, not as unread', async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.getComparison.mockRejectedValue(new NotFoundError('Comparison not found'));

    const result = await tool.execute(tool.validate(ARGS), asCreator);

    expect(result.error?.code).toBe('NOT_FOUND');
    expect(result.error?.message).toContain('deleted');
  });

  it('names the draft a refusal is about, and the fields that differ', async () => {
    mocks.prepareComparison.mockRejectedValue(
      new APIError(
        'That review was not reviewed the way this comparison is.',
        'REVIEW_NOT_COMPARABLE',
        409,
        {
          position: 2,
          reason: 'options_differ',
          differs: ['project', 'judges'],
        }
      )
    );

    const result = await tool.execute(
      tool.validate({
        drafts: [{ text: OPENING_A }, { assessmentId: 'a-1' }, { assessmentId: 'a-2' }],
      }),
      asCreator
    );

    expect(result.error).toEqual({
      code: 'REVIEW_NOT_COMPARABLE',
      message:
        'The draft at position 2: That review was not reviewed the way this comparison is. It differs in: project, judges.',
    });
  });

  it('previews a refusal by its code and message', () => {
    const redacted = tool.redactProvenance(tool.validate(ARGS), {
      success: false,
      error: { code: 'STORED_UNREAD', message: 'stored' },
    });

    expect(redacted.resultPreview).toBe(
      JSON.stringify({ code: 'STORED_UNREAD', message: 'stored' })
    );
  });

  it('refuses arguments the API takes but the tool does not', () => {
    expect(() => tool.validate({ ...ARGS, profile: 'quick' })).toThrow();
    expect(() => tool.validate({ drafts: [{ text: OPENING_A }] })).toThrow();
  });
});

describe('get_comparison', () => {
  const tool = new GetComparisonCapability();

  it('reads the comparison in the key’s workspace, with no person behind the key', async () => {
    mocks.getComparison.mockResolvedValue(detail('completed', 'completed'));

    const result = await tool.execute(tool.validate({ comparisonId: 'cmp-1' }), noCreator);

    expect(mocks.getComparison).toHaveBeenCalledWith('cmp-1');
    expect(result.data).toMatchObject({
      id: 'cmp-1',
      ready: true,
      drafts: [
        { position: 0, label: 'Sarah', assessmentId: 'a-1', overall: 71 },
        { position: 1, label: 'Teams', assessmentId: 'a-2', overall: 58 },
      ],
    });
  });

  it('answers another workspace’s id as not found, as the API does', async () => {
    mocks.getComparison.mockRejectedValue(new NotFoundError('Comparison not found'));

    const result = await tool.execute(tool.validate({ comparisonId: 'theirs' }), asCreator);

    expect(result).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Comparison not found' },
    });
  });

  it('lets an unexpected failure through, for the dispatcher to log', async () => {
    mocks.getComparison.mockRejectedValue(new Error('db down'));

    await expect(tool.execute(tool.validate({ comparisonId: 'cmp-1' }), asCreator)).rejects.toThrow(
      'db down'
    );
  });

  it('keeps only an id-shaped comparisonId of arguments sent as they were', () => {
    const redacted = tool.redactProvenance(
      { comparisonId: 'Sarah at Acme', note: 'Jane Doe' } as never,
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'no' } }
    );

    expect(redacted.args).toEqual({ comparisonId: '[value]' });
  });

  it('keeps the id and the status in the audit trail', () => {
    const redacted = tool.redactProvenance(
      { comparisonId: 'cmp-1' },
      { success: true, data: { id: 'cmp-1', status: 'completed' } as never }
    );

    expect(redacted).toEqual({
      args: { comparisonId: 'cmp-1' },
      resultPreview: JSON.stringify({ id: 'cmp-1', status: 'completed' }),
    });
  });

  it('previews a refusal by its code and message', () => {
    const redacted = tool.redactProvenance(
      { comparisonId: 'theirs' },
      { success: false, error: { code: 'NOT_FOUND', message: 'Comparison not found' } }
    );

    expect(redacted.resultPreview).toBe(
      JSON.stringify({ code: 'NOT_FOUND', message: 'Comparison not found' })
    );
  });
});
