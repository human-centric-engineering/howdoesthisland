/**
 * The work of `rewrite_draft` (t-94), loaded on its first call.
 *
 * The route's steps in the route's order (`app/api/v1/rewrites/route.ts`):
 * the per-person cap (`rewriteLimiter`, keyed `user:<id>`, the route's bucket),
 * then `startRewrite`, which checks the review, holds the budget and writes
 * the row, or throws before anything is written or spent. Before either, the
 * key's creator must still be able to spend in the key's workspace
 * (`spender.ts`).
 *
 * **The rewrite does not run inside this call.** `startRewrite` hands its run
 * to `keepRunningAfterResponse` before it returns, so it is saved, ended and
 * charged whether or not anyone waits for it; on a serverless host that keeps
 * the MCP route's function alive, up to its `maxDuration`, after the tool has
 * answered (divergence row 32). So this waits up to `MCP_WAIT_MS` for it to
 * end, and past that answers the id and status for `get_rewrite` to read back.
 */
import { refusalOf } from '@/lib/app/mcp/run/refusal';
import { capRefusal, spenderRefusal } from '@/lib/app/mcp/run/spender';
import { summariseRewrite, type RewriteSummaryForAssistant } from '@/lib/app/mcp/rewrite-summary';
import { MCP_WAIT_MS, type ToolOutcome } from '@/lib/app/mcp/tool-support';
import { rewriteLimiter } from '@/lib/app/rewrites/limiter';
import { startRewrite } from '@/lib/app/rewrites/service';
import type { CreateRewriteRequest } from '@/lib/app/rewrites/validations';
import type { RewriteView } from '@/lib/app/rewrites/views';

/** `done`'s view once it ends, or `null` once `ms` has passed first. */
async function within(done: Promise<RewriteView>, ms: number): Promise<RewriteView | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([done, bound]);
  } finally {
    clearTimeout(timer);
  }
}

export async function rewriteDraftTool(
  body: CreateRewriteRequest,
  userId: string
): Promise<ToolOutcome<RewriteSummaryForAssistant>> {
  const refused = await spenderRefusal(userId);
  if (refused) return { refusal: refused };
  const limit = rewriteLimiter.check(`user:${userId}`);
  if (!limit.success) return { refusal: capRefusal(limit.reset, 'rewrites') };
  let started;
  try {
    started = await startRewrite(body, { userId });
  } catch (err) {
    const refusal = refusalOf(err);
    if (!refusal) throw err;
    return { refusal };
  }
  // Stored from here on, and `done` never rejects: the answer always carries its id.
  const ended = await within(started.done, MCP_WAIT_MS);
  return { data: summariseRewrite(ended ?? started.rewrite) };
}
