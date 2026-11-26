/**
 * Whether the person behind a key may start work that spends (t-92, t-93),
 * loaded with a spending tool's work: it reads the database.
 *
 * A key outlives its creator's removal (only erasure nulls `createdBy`), and
 * the person a review is charged to must be one who can spend in the key's
 * workspace. So before anything is prepared or charged, the creator must
 * still be a member of it, and the workspace not suspended.
 */
import type { ToolRefusal } from '@/lib/app/mcp/tool-support';
import { prisma } from '@/lib/db/client';
import { verifiedMembership } from '@/lib/tenancy/entry';
import { requireOrgId } from '@/lib/tenancy/context';

/** The refusal for `userId` in the current workspace, or `null` when they may spend. */
export async function spenderRefusal(userId: string): Promise<ToolRefusal | null> {
  const membership = await verifiedMembership(userId, requireOrgId(), prisma);
  if (!('refused' in membership)) return null;
  if (membership.refused === 'org-suspended') {
    return {
      code: 'WORKSPACE_SUSPENDED',
      message: 'This workspace is suspended, so it cannot start work that spends credits.',
    };
  }
  return {
    code: 'KEY_HAS_NO_OWNER',
    message:
      'The person this runs for (over MCP, the key’s creator) is no longer in the workspace, so it cannot start work that spends credits. Over MCP, ask a workspace owner for a new key.',
  };
}

/** The per-person cap's refusal, `reset` being the limiter's (seconds since the epoch). */
export function capRefusal(reset: number, what: string): ToolRefusal {
  const seconds = Math.max(1, reset - Math.floor(Date.now() / 1000));
  return {
    code: 'RATE_LIMIT_EXCEEDED',
    message: `Too many ${what} started in the last minute. Try again in ${seconds} seconds.`,
  };
}
