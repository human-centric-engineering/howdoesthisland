/**
 * Whether the person behind a call may still use the workspace's tools
 * (t-96), loaded with a tool's work: it reads the database.
 *
 * An MCP key acts as its creator, and it outlives its creator's removal from
 * the workspace (only erasure nulls `createdBy`). So a tool that only reads
 * still checks, as the spending tools do (`spender.ts`), that the person it
 * runs for is a member of the workspace it reads, and the workspace is not
 * suspended. Checked on every call rather than by revoking a member's keys
 * when they leave, so it covers keys whose creator left before this, without
 * a hook in core's member removal or an edit to core's transport.
 *
 * **No person is refused, except within a workflow.** Over MCP a call with no
 * person is a key whose creator was erased, and a chat turn always has one.
 * A workflow can run with nobody behind it (a schedule) and reads inside its
 * own workspace, so it keeps reading as before.
 */
import type { ToolCaller, ToolRefusal } from '@/lib/app/mcp/tool-support';
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import { verifiedMembership } from '@/lib/tenancy/entry';

const LEFT: ToolRefusal = {
  code: 'KEY_HAS_NO_OWNER',
  message:
    'The person this runs for (over MCP, the key’s creator) is no longer in the workspace, so it cannot use the workspace’s tools. Over MCP, ask a workspace owner for a new key.',
};

/** The refusal for `caller` in the current workspace, or `null` when they may go on. */
export async function callerRefusal(caller: ToolCaller): Promise<ToolRefusal | null> {
  if (caller.userId === null) return caller.inWorkflow ? null : LEFT;
  const membership = await verifiedMembership(caller.userId, requireOrgId(), prisma);
  if (!('refused' in membership)) return null;
  if (membership.refused === 'org-suspended') {
    return { code: 'WORKSPACE_SUSPENDED', message: 'This workspace is suspended.' };
  }
  return LEFT;
}
