/**
 * The three MCP tools of t-92 around the library they share with the routes.
 *
 * The library is mocked: these pin what each tool adds, which is the person
 * behind the key, the route's order of steps, the bound, the refusals an
 * assistant can read, and what the audit trail keeps. That the library itself
 * charges and runs is the routes' tests'; that the transport reaches these
 * through a key's workspace is the smoke run's (`.context/app/mcp.md`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runQuickScan: vi.fn(),
  summariseQuickScan: vi.fn(),
  isQuickScanEnabled: vi.fn(),
  prepareAssessment: vi.fn(),
  holdReviewBudget: vi.fn(),
  createAssessment: vi.fn(),
  limiterCheck: vi.fn(),
  startWaitingReviews: vi.fn(),
  summariseAssessment: vi.fn(),
  readAssessmentSummary: vi.fn(),
  release: vi.fn(),
}));

vi.mock('@/lib/app/assessments/api/scan', () => ({ runQuickScan: mocks.runQuickScan }));
vi.mock('@/lib/app/quick-scan/summary', () => ({ summariseQuickScan: mocks.summariseQuickScan }));
vi.mock('@/lib/app/quick-scan/switch', () => ({ isQuickScanEnabled: mocks.isQuickScanEnabled }));
vi.mock('@/lib/app/assessments/api/service', () => ({
  prepareAssessment: mocks.prepareAssessment,
  holdReviewBudget: mocks.holdReviewBudget,
  createAssessment: mocks.createAssessment,
}));
vi.mock('@/lib/app/assessments/api/limiter', () => ({
  aiAssessmentLimiter: { check: mocks.limiterCheck },
}));
vi.mock('@/lib/app/assessments/kick', () => ({ startWaitingReviews: mocks.startWaitingReviews }));
vi.mock('@/lib/app/mcp/assessment-summary', () => ({
  summariseAssessment: mocks.summariseAssessment,
  readAssessmentSummary: mocks.readAssessmentSummary,
}));
vi.mock('@/lib/tenancy/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/context')>()),
  requireOrgId: () => 'org-1',
}));
vi.mock('@/lib/db/client', () => ({ prisma: {} }));

import { APIError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { WorkspaceBusyError } from '@/lib/app/assessments/places';
import { AssessDraftCapability } from '@/lib/app/mcp/assess-draft';
import { GetAssessmentCapability } from '@/lib/app/mcp/get-assessment';
import { QuickScanCapability } from '@/lib/app/mcp/quick-scan';
import { MCP_WAIT_MS } from '@/lib/app/mcp/tool-support';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

const asCreator: CapabilityContext = { userId: 'user-1', agentId: 'mcp-system' };
const noCreator: CapabilityContext = { userId: null, agentId: 'mcp-system' };

const DRAFT = 'Our platform will revolutionise how teams work. Sarah at Acme saved 4 hours a week.';

beforeEach(() => {
  mocks.isQuickScanEnabled.mockReturnValue(true);
  mocks.limiterCheck.mockReturnValue({ success: true, limit: 3, remaining: 2, reset: 0 });
  mocks.prepareAssessment.mockResolvedValue({
    judges: ['ethos', 'logos'],
    hold: { release: mocks.release },
  });
  mocks.holdReviewBudget.mockResolvedValue(undefined);
  mocks.createAssessment.mockResolvedValue({
    kind: 'stored',
    final: false,
    assessment: { id: 'a-1', status: 'running' },
  });
  mocks.summariseAssessment.mockResolvedValue({ id: 'a-1', status: 'running', ready: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('quick_scan', () => {
  const tool = new QuickScanCapability();

  it('runs the route’s quick scan and answers its summary, with no person behind the key', async () => {
    mocks.runQuickScan.mockResolvedValue({ overall: 41 });
    mocks.summariseQuickScan.mockReturnValue({ overall: 41, band: 'Weak', caveat: 'surface' });

    const result = await tool.execute(tool.validate({ text: DRAFT }), noCreator);

    expect(mocks.runQuickScan).toHaveBeenCalledWith({ text: DRAFT });
    expect(mocks.summariseQuickScan).toHaveBeenCalledWith({ overall: 41 });
    expect(result).toEqual({
      success: true,
      data: { overall: 41, band: 'Weak', caveat: 'surface' },
    });
  });

  it('is off when the quick scan’s switch is, as the route is', async () => {
    mocks.isQuickScanEnabled.mockReturnValue(false);

    const result = await tool.execute(tool.validate({ text: DRAFT }), asCreator);

    expect(result).toEqual({
      success: false,
      error: { code: 'QUICK_SCAN_OFF', message: expect.any(String) },
    });
    expect(mocks.runQuickScan).not.toHaveBeenCalled();
  });

  it('answers a context the framework refuses with the field that is wrong', async () => {
    mocks.runQuickScan.mockRejectedValue(
      new ValidationError('The context does not fit this version', {
        errors: [{ path: 'contentType', message: 'Not a content type in this version' }],
      })
    );

    const result = await tool.execute(
      tool.validate({ text: DRAFT, context: { contentType: 'haiku' } }),
      asCreator
    );

    expect(result).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message:
          'The context does not fit this version: contentType: Not a content type in this version',
      },
    });
  });

  it('lets an unexpected failure through, for the dispatcher to log', async () => {
    mocks.runQuickScan.mockRejectedValue(new Error('engine missing'));

    await expect(tool.execute(tool.validate({ text: DRAFT }), asCreator)).rejects.toThrow(
      'engine missing'
    );
  });

  it('previews a refusal by its code and message', () => {
    const redacted = tool.redactProvenance(
      { text: DRAFT },
      { success: false, error: { code: 'QUICK_SCAN_OFF', message: 'off' } }
    );

    expect(redacted.resultPreview).toBe(JSON.stringify({ code: 'QUICK_SCAN_OFF', message: 'off' }));
  });

  it('refuses arguments the API does not take', () => {
    expect(() => tool.validate({ text: DRAFT, url: 'https://example.com' })).toThrow();
  });

  it('keeps the draft’s length in the audit trail, never its words', () => {
    const redacted = tool.redactProvenance(
      { text: DRAFT },
      { success: true, data: { overall: 41, band: 'Weak', caveat: DRAFT } as never }
    );

    expect(redacted.args).toEqual({ textChars: DRAFT.length, context: undefined });
    expect(JSON.stringify(redacted)).not.toContain('Sarah');
  });
});

describe('assess_draft', () => {
  const tool = new AssessDraftCapability();

  it('takes the route’s steps in its order, as the key’s creator, recorded as MCP', async () => {
    const order: string[] = [];
    mocks.prepareAssessment.mockImplementation(async () => {
      order.push('prepare');
      return { judges: ['ethos'], hold: { release: mocks.release } };
    });
    mocks.limiterCheck.mockImplementation(() => {
      order.push('cap');
      return { success: true, limit: 3, remaining: 2, reset: 0 };
    });
    mocks.holdReviewBudget.mockImplementation(async () => order.push('budget'));
    mocks.createAssessment.mockImplementation(async () => {
      order.push('create');
      return { kind: 'stored', final: false, assessment: { id: 'a-1', status: 'running' } };
    });
    mocks.release.mockImplementation(async () => order.push('release'));

    const result = await tool.execute(
      tool.validate({ text: DRAFT, title: 'Launch email', projectId: 'p-1' }),
      asCreator
    );

    const body = {
      source: { text: DRAFT },
      title: 'Launch email',
      projectId: 'p-1',
      wait: true,
    };
    expect(order).toEqual(['prepare', 'cap', 'budget', 'create', 'release']);
    expect(mocks.prepareAssessment).toHaveBeenCalledWith(body);
    expect(mocks.limiterCheck).toHaveBeenCalledWith('user:user-1');
    expect(mocks.createAssessment).toHaveBeenCalledWith(
      body,
      expect.anything(),
      { userId: 'user-1', apiKeyId: null, via: 'MCP' },
      { boundMs: MCP_WAIT_MS }
    );
    expect(mocks.summariseAssessment).toHaveBeenCalledWith({ id: 'a-1', status: 'running' });
    expect(result).toEqual({
      success: true,
      data: { id: 'a-1', status: 'running', ready: false },
    });
  });

  it('waits less than the 60 seconds many MCP clients give a tool call', () => {
    expect(MCP_WAIT_MS).toBeLessThan(60_000);
  });

  it('reads a draft from a url as the API does', async () => {
    await tool.execute(tool.validate({ url: 'https://example.com/launch' }), asCreator);

    expect(mocks.prepareAssessment).toHaveBeenCalledWith({
      source: { url: 'https://example.com/launch' },
      wait: true,
    });
  });

  it('takes text or a url, not both and not neither', () => {
    expect(() => tool.validate({ text: DRAFT, url: 'https://example.com' })).toThrow();
    expect(() => tool.validate({ title: 'Nothing to review' })).toThrow();
    expect(() => tool.validate({ url: 'ftp://example.com/file' })).toThrow();
  });

  it('refuses a key whose creator has gone, before anything is prepared or charged', async () => {
    const result = await tool.execute(tool.validate({ text: DRAFT }), noCreator);

    expect(result).toEqual({
      success: false,
      error: { code: 'KEY_HAS_NO_OWNER', message: expect.stringContaining('new key') },
    });
    expect(mocks.prepareAssessment).not.toHaveBeenCalled();
    expect(mocks.holdReviewBudget).not.toHaveBeenCalled();
    expect(mocks.createAssessment).not.toHaveBeenCalled();
  });

  it('refuses past the per-person cap without charging, and releases the hold', async () => {
    mocks.limiterCheck.mockReturnValue({
      success: false,
      limit: 3,
      remaining: 0,
      reset: Math.floor(Date.now() / 1000) + 30,
    });

    const result = await tool.execute(tool.validate({ text: DRAFT }), asCreator);

    expect(result).toEqual({
      success: false,
      error: { code: 'RATE_LIMITED', message: expect.stringMatching(/Try again in \d+ seconds/) },
    });
    expect(mocks.holdReviewBudget).not.toHaveBeenCalled();
    expect(mocks.createAssessment).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('skips the cap and the budget for a review that calls no judge, as the route does', async () => {
    mocks.prepareAssessment.mockResolvedValue({ judges: [], hold: undefined });

    await tool.execute(tool.validate({ text: DRAFT }), asCreator);

    expect(mocks.limiterCheck).not.toHaveBeenCalled();
    expect(mocks.holdReviewBudget).not.toHaveBeenCalled();
    expect(mocks.createAssessment).toHaveBeenCalledTimes(1);
  });

  it('answers a refusal for credits in the library’s words, and releases the hold', async () => {
    mocks.holdReviewBudget.mockRejectedValue(
      new APIError('This workspace has no review credits left.', 'INSUFFICIENT_CREDITS', 402)
    );

    const result = await tool.execute(tool.validate({ text: DRAFT }), asCreator);

    expect(result).toEqual({
      success: false,
      error: {
        code: 'INSUFFICIENT_CREDITS',
        message: 'This workspace has no review credits left.',
      },
    });
    expect(mocks.createAssessment).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('answers a busy workspace, and starts the queue when it can', async () => {
    // Waiting reviews with a place free: the caller should start them.
    const busy = new WorkspaceBusyError({ running: 1, waiting: 2 });
    expect(busy.queueCanStart).toBe(true);
    mocks.createAssessment.mockRejectedValue(busy);

    const result = await tool.execute(tool.validate({ text: DRAFT }), asCreator);

    expect(result).toEqual({
      success: false,
      error: { code: 'WORKSPACE_BUSY', message: busy.message },
    });
    expect(mocks.startWaitingReviews).toHaveBeenCalledWith('org-1');
  });

  it('refuses, rather than answers, a review that was not stored', async () => {
    mocks.createAssessment.mockResolvedValue({ kind: 'ephemeral', assessment: {} });

    const result = await tool.execute(tool.validate({ text: DRAFT }), asCreator);

    expect(result).toMatchObject({ success: false, error: { code: 'NOT_STORED' } });
  });

  it('lets an unexpected failure through, for the dispatcher to log', async () => {
    mocks.createAssessment.mockRejectedValue(new Error('connection reset'));

    await expect(tool.execute(tool.validate({ text: DRAFT }), asCreator)).rejects.toThrow(
      'connection reset'
    );
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('keeps a url draft as a placeholder in the audit trail, and a refusal by its code', () => {
    const redacted = tool.redactProvenance(
      { url: 'https://example.com/sarah-launch' },
      { success: false, error: { code: 'RATE_LIMITED', message: 'Try again' } }
    );

    expect(redacted.args).toEqual({ url: '[url]', projectId: undefined, context: undefined });
    expect(redacted.resultPreview).toBe(
      JSON.stringify({ code: 'RATE_LIMITED', message: 'Try again' })
    );
  });

  it('keeps no words of the draft or its title in the audit trail', () => {
    const redacted = tool.redactProvenance(
      { text: DRAFT, title: 'Sarah’s launch email', projectId: 'p-1' },
      { success: true, data: { id: 'a-1', status: 'running', ready: false } as never }
    );

    expect(redacted.args).toEqual({
      textChars: DRAFT.length,
      title: '[title]',
      projectId: 'p-1',
      context: undefined,
    });
    expect(redacted.resultPreview).toBe(JSON.stringify({ id: 'a-1', status: 'running' }));
    expect(JSON.stringify(redacted)).not.toContain('Sarah');
  });
});

describe('get_assessment', () => {
  const tool = new GetAssessmentCapability();

  it('answers the workspace’s assessment summarised, with no person behind the key', async () => {
    mocks.readAssessmentSummary.mockResolvedValue({ id: 'a-1', status: 'completed', ready: true });

    const result = await tool.execute(tool.validate({ assessmentId: 'a-1' }), noCreator);

    expect(mocks.readAssessmentSummary).toHaveBeenCalledWith('a-1');
    expect(result).toEqual({
      success: true,
      data: { id: 'a-1', status: 'completed', ready: true },
    });
  });

  it('answers another workspace’s id as not found', async () => {
    mocks.readAssessmentSummary.mockRejectedValue(new NotFoundError('Assessment not found'));

    const result = await tool.execute(tool.validate({ assessmentId: 'elsewhere' }), asCreator);

    expect(result).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Assessment not found' },
    });
  });

  it('lets an unexpected failure through, for the dispatcher to log', async () => {
    mocks.readAssessmentSummary.mockRejectedValue(new Error('connection reset'));

    await expect(tool.execute(tool.validate({ assessmentId: 'a-1' }), asCreator)).rejects.toThrow(
      'connection reset'
    );
  });

  it('previews a refusal by its code', () => {
    const redacted = tool.redactProvenance(
      { assessmentId: 'a-1' },
      { success: false, error: { code: 'NOT_FOUND', message: 'Assessment not found' } }
    );

    expect(redacted.resultPreview).toContain('NOT_FOUND');
  });

  it('previews only the id and status, since the summary quotes the draft', () => {
    const redacted = tool.redactProvenance(
      { assessmentId: 'a-1' },
      {
        success: true,
        data: { id: 'a-1', status: 'completed', ready: true, verdict: DRAFT } as never,
      }
    );

    expect(redacted.resultPreview).toBe(JSON.stringify({ id: 'a-1', status: 'completed' }));
  });
});
