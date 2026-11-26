/**
 * A JSON-RPC batch carries one call to a tool that holds the request (t-92,
 * divergence row 33): each later one is answered with an error, never
 * dispatched, so the batch cannot outlast the route's `maxDuration`.
 *
 * Fork-owned, beside core's `route.test.ts`, so a sync takes that file as theirs.
 *
 * @see lib/app/mcp/batch.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { JsonRpcErrorCode } from '@/types/mcp';

const mockAuthContext = {
  apiKeyId: 'key-1',
  apiKeyName: 'Test Key',
  scopes: ['tools:list', 'tools:execute'],
  createdBy: 'admin-1',
  clientIp: '127.0.0.1',
  userAgent: 'test-agent',
  scopedAgentId: null,
  orgId: 'cmorg000000000000000other',
};

vi.mock('@/lib/security/ip', () => ({ getClientIP: vi.fn(() => '127.0.0.1') }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/orchestration/mcp', () => ({
  authenticateMcpRequest: vi.fn(async () => mockAuthContext),
  getMcpServerConfig: vi.fn(async () => ({ id: 'config-1', isEnabled: true })),
  handleMcpRequest: vi.fn(),
  getMcpRateLimiter: vi.fn(() => ({ check: vi.fn(() => ({ success: true })) })),
  listMcpTools: vi.fn(),
}));

import { handleMcpRequest, listMcpTools } from '@/lib/orchestration/mcp';
import { POST } from '@/app/api/v1/mcp/route';
import { BATCH_SOLO_MESSAGE, refusedInBatch } from '@/lib/app/mcp/batch';

const call = (id: number | undefined, name: string) => ({
  jsonrpc: '2.0',
  ...(id === undefined ? {} : { id }),
  method: 'tools/call',
  params: { name, arguments: {} },
});

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost:3000/api/v1/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-api-key' },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listMcpTools).mockResolvedValue([
    { name: 'assess_draft', slug: 'assess_draft' },
    { name: 'review_it', slug: 'assess_draft' },
    { name: 'quick_scan', slug: 'quick_scan' },
    { name: 'compare_drafts', slug: 'compare_drafts' },
  ] as never);
  vi.mocked(handleMcpRequest).mockImplementation(async (req) => ({
    jsonrpc: '2.0',
    id: req.id ?? null,
    result: {},
  }));
});

describe('POST /mcp — a batch of request-holding tool calls', () => {
  it('dispatches the first assess_draft and refuses each later one, in order', async () => {
    const response = await post([
      call(1, 'assess_draft'),
      call(2, 'quick_scan'),
      call(3, 'assess_draft'),
      call(4, 'review_it'),
    ]);

    expect(response.status).toBe(200);
    const refusal = { code: JsonRpcErrorCode.INVALID_REQUEST, message: BATCH_SOLO_MESSAGE };
    expect(await response.json()).toEqual([
      { jsonrpc: '2.0', id: 1, result: {} },
      { jsonrpc: '2.0', id: 2, result: {} },
      { jsonrpc: '2.0', id: 3, error: refusal },
      { jsonrpc: '2.0', id: 4, error: refusal },
    ]);
    expect(vi.mocked(handleMcpRequest).mock.calls.map(([req]) => req.id)).toEqual([1, 2]);
  });

  it('counts compare_drafts with assess_draft: one waiting call per batch (t-93)', async () => {
    const response = await post([
      call(1, 'compare_drafts'),
      call(2, 'assess_draft'),
      call(3, 'compare_drafts'),
    ]);

    const refusal = { code: JsonRpcErrorCode.INVALID_REQUEST, message: BATCH_SOLO_MESSAGE };
    expect(await response.json()).toEqual([
      { jsonrpc: '2.0', id: 1, result: {} },
      { jsonrpc: '2.0', id: 2, error: refusal },
      { jsonrpc: '2.0', id: 3, error: refusal },
    ]);
    expect(vi.mocked(handleMcpRequest).mock.calls.map(([req]) => req.id)).toEqual([1]);
  });

  it('answers nothing for a refused notification, which has no id', async () => {
    const response = await post([call(1, 'assess_draft'), call(undefined, 'assess_draft')]);

    expect(await response.json()).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
    expect(handleMcpRequest).toHaveBeenCalledTimes(1);
  });

  it('never refuses a single request, and reads no tool list for it', async () => {
    const response = await post(call(1, 'assess_draft'));

    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect(listMcpTools).not.toHaveBeenCalled();
  });
});

describe('refusedInBatch', () => {
  it('reads no tool list for a batch with no tool call', async () => {
    const refused = await refusedInBatch([
      { method: 'tools/list' },
      { method: 'tools/call', params: { arguments: {} } },
    ]);

    expect(refused).toEqual([false, false]);
    expect(listMcpTools).not.toHaveBeenCalled();
  });

  it('lets through calls to unknown tools and other tools however many there are', async () => {
    const refused = await refusedInBatch([
      { method: 'tools/call', params: { name: 'quick_scan' } },
      { method: 'tools/call', params: { name: 'quick_scan' } },
      { method: 'tools/call', params: { name: 'nope' } },
      { method: 'tools/call', params: { name: 'nope' } },
    ]);

    expect(refused).toEqual([false, false, false, false]);
  });
});
