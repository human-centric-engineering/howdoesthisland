/**
 * Whether the key behind an MCP call may still use the workspace's tools
 * (t-96), loaded with a tool's work: it reads the database.
 *
 * An MCP key acts as its creator, and it outlives its creator's removal from
 * the workspace (only erasure nulls `createdBy`). So over MCP a tool that does
 * not spend still checks, as the spending tools do (`spender.ts`), that the
 * key's creator is a member of the workspace it reads, and the workspace is
 * not suspended. Checked on every call rather than by revoking a member's keys
 * when they leave, so it covers keys whose creator left before this, without a
 * hook in core's member removal or an edit to core's transport.
 *
 * **Only over MCP.** A chat turn's person entered the workspace through a
 * session, which may be a support grant or an embed visitor rather than a
 * membership, and a workflow may run with nobody behind it. Those calls are
 * not a key's, and are left as they were.
 */
import type { ToolCaller, ToolRefusal } from '@/lib/app/mcp/tool-support';
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import { verifiedMembership } from '@/lib/tenancy/entry';

const ERASED: ToolRefusal = {
  code: 'KEY_HAS_NO_OWNER',
  message:
    'The key’s creator no longer has an account, so the key cannot use the workspace’s tools. Ask a workspace owner for a new key.',
};

const LEFT: ToolRefusal = {
  code: 'KEY_HAS_NO_OWNER',
  message:
    'The key’s creator is no longer in the workspace, so the key cannot use the workspace’s tools. Ask a workspace owner for a new key.',
};

/** The refusal for `caller` in the current workspace, or `null` when it may go on. */
export async function callerRefusal(caller: ToolCaller): Promise<ToolRefusal | null> {
  if (!caller.viaMcp) return null;
  if (caller.userId === null) return ERASED;
  const membership = await verifiedMembership(caller.userId, requireOrgId(), prisma);
  if (!('refused' in membership)) return null;
  if (membership.refused === 'org-suspended') {
    return { code: 'WORKSPACE_SUSPENDED', message: 'This workspace is suspended.' };
  }
  return LEFT;
}
