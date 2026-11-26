/**
 * The four MCP tools that do not spend, and the person behind the key (t-96).
 *
 * A key acts as its creator and outlives their removal from the workspace, so
 * over MCP each of these refuses a creator who is no longer a member, or who
 * has gone, before it reads anything; a member reads as before. A chat turn or
 * a workflow step is not a key's call, and is not checked: its person may be a
 * support admin or an embed visitor, or nobody.
 *
 * The work behind each tool is mocked: what it reads is its own file's tests'.
 * These pin only who may reach it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifiedMembership: vi.fn(),
  runQuickScan: vi.fn(),
  readAssessmentSummary: vi.fn(),
  getComparison: vi.fn(),
  getRewrite: vi.fn(),
}));

vi.mock('@/lib/tenancy/entry', () => ({ verifiedMembership: mocks.verifiedMembership }));
vi.mock('@/lib/tenancy/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/context')>()),
  requireOrgId: () => 'org-1',
}));
vi.mock('@/lib/db/client', () => ({ prisma: {} }));
vi.mock('@/lib/app/quick-scan/switch', () => ({ isQuickScanEnabled: () => true }));
vi.mock('@/lib/app/assessments/api/scan', () => ({ runQuickScan: mocks.runQuickScan }));
vi.mock('@/lib/app/quick-scan/summary', () => ({ summariseQuickScan: () => ({ overall: 41 }) }));
vi.mock('@/lib/app/mcp/assessment-summary', () => ({
  readAssessmentSummary: mocks.readAssessmentSummary,
}));
vi.mock('@/lib/app/comparisons/service', () => ({ getComparison: mocks.getComparison }));
vi.mock('@/lib/app/mcp/comparison-summary', () => ({
  summariseComparison: () => ({ id: 'cmp-1' }),
}));
vi.mock('@/lib/app/rewrites/service', () => ({ getRewrite: mocks.getRewrite }));
vi.mock('@/lib/app/mcp/rewrite-summary', () => ({ summariseRewrite: () => ({ id: 'rw-1' }) }));

import { GetAssessmentCapability } from '@/lib/app/mcp/get-assessment';
import { GetComparisonCapability } from '@/lib/app/mcp/get-comparison';
import { GetRewriteCapability } from '@/lib/app/mcp/get-rewrite';
import { QuickScanCapability } from '@/lib/app/mcp/quick-scan';
import type { CapabilityContext, CapabilityResult } from '@/lib/orchestration/capabilities/types';

const asCreator: CapabilityContext = { userId: 'user-1', agentId: 'mcp-system' };
const noCreator: CapabilityContext = { userId: null, agentId: 'mcp-system' };
/** What core's chat handler sends: a session's person, who need not be a member. */
const chatTurn: CapabilityContext = {
  userId: 'embed:visitor-1',
  agentId: 'agent-1',
  conversationId: 'conv-1',
};
/** What core's workflow executors send: a scheduled run has nobody behind it. */
const workflowStep: CapabilityContext = {
  userId: null,
  agentId: 'workflow:wf-1',
  workflowExecutionId: 'exec-1',
};

interface ReadTool {
  name: string;
  run: (context: CapabilityContext) => Promise<CapabilityResult<unknown>>;
  /** The work the tool reads with, which a refusal must not reach. */
  work: ReturnType<typeof vi.fn>;
}

const TOOLS: ReadTool[] = [
  {
    name: 'quick_scan',
    run: (context) => new QuickScanCapability().execute({ text: 'A draft.' }, context),
    work: mocks.runQuickScan,
  },
  {
    name: 'get_assessment',
    run: (context) => new GetAssessmentCapability().execute({ assessmentId: 'a-1' }, context),
    work: mocks.readAssessmentSummary,
  },
  {
    name: 'get_comparison',
    run: (context) => new GetComparisonCapability().execute({ comparisonId: 'cmp-1' }, context),
    work: mocks.getComparison,
  },
  {
    name: 'get_rewrite',
    run: (context) => new GetRewriteCapability().execute({ rewriteId: 'rw-1' }, context),
    work: mocks.getRewrite,
  },
];

beforeEach(() => {
  mocks.verifiedMembership.mockResolvedValue({ role: 'MEMBER' });
  mocks.runQuickScan.mockResolvedValue({});
  mocks.readAssessmentSummary.mockResolvedValue({ id: 'a-1' });
  mocks.getComparison.mockResolvedValue({});
  mocks.getRewrite.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe.each(TOOLS)('$name', ({ run, work }) => {
  it('reads for a creator who is still a member of the key’s workspace', async () => {
    const result = await run(asCreator);

    expect(result.success).toBe(true);
    expect(mocks.verifiedMembership).toHaveBeenCalledWith('user-1', 'org-1', expect.anything());
    expect(work).toHaveBeenCalledOnce();
  });

  it('refuses a key whose creator has left the workspace, before reading anything', async () => {
    mocks.verifiedMembership.mockResolvedValue({ refused: 'not-a-member' });

    const result = await run(asCreator);

    expect(result).toEqual({
      success: false,
      error: {
        code: 'KEY_HAS_NO_OWNER',
        message: expect.stringContaining('no longer in the workspace'),
      },
    });
    expect(work).not.toHaveBeenCalled();
  });

  it('refuses a key whose creator has gone, without asking who is a member', async () => {
    const result = await run(noCreator);

    expect(result).toEqual({
      success: false,
      error: {
        code: 'KEY_HAS_NO_OWNER',
        message: expect.stringContaining('no longer has an account'),
      },
    });
    expect(mocks.verifiedMembership).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it('refuses a suspended workspace in its own words', async () => {
    mocks.verifiedMembership.mockResolvedValue({ refused: 'org-suspended' });

    const result = await run(asCreator);

    expect(result.error?.code).toBe('WORKSPACE_SUSPENDED');
    expect(work).not.toHaveBeenCalled();
  });

  it.each([
    ['a chat turn', chatTurn],
    ['a workflow step', workflowStep],
    ['a workflow step run for someone', { ...workflowStep, userId: 'user-2' }],
  ])('leaves %s unchecked, as it was before', async (_label, context) => {
    mocks.verifiedMembership.mockResolvedValue({ refused: 'not-a-member' });

    const result = await run(context);

    expect(result.success).toBe(true);
    expect(mocks.verifiedMembership).not.toHaveBeenCalled();
    expect(work).toHaveBeenCalledOnce();
  });
});
