/**
 * Which calls of a JSON-RPC batch the MCP route refuses (t-92, t-93).
 *
 * The route runs a batch's calls one after another in one request. A tool that
 * holds the request while its work runs (`assess_draft` and `compare_drafts`
 * wait up to `MCP_WAIT_MS` for their reviews) adds that wait per call, so a batch of them
 * outlasts the route's `maxDuration`: the platform ends the function, the
 * client gets no answer, and the reviews it stored, and charged for, are cut
 * off until recovery. So a batch may carry one call to such a tool; each later
 * one is refused with a JSON-RPC error saying to send it on its own. A single
 * request is never refused here.
 *
 * Called from `app/api/v1/mcp/route.ts` (divergence row 33). Names are
 * resolved to slugs through the exposed tools, as `callMcpTool` resolves them,
 * so a tool exposed under another name is still counted.
 */
import { ASSESS_DRAFT, COMPARE_DRAFTS } from '@/lib/app/mcp/definitions';
import { listMcpTools } from '@/lib/orchestration/mcp';
import { mcpToolCallParamsSchema } from '@/lib/validations/mcp';

/** The capability slugs that hold the request while their work runs: one call per batch. */
export const BATCH_SOLO_SLUGS: ReadonlySet<string> = new Set([
  ASSESS_DRAFT.name,
  COMPARE_DRAFTS.name,
]);

/** What a refused call answers. */
export const BATCH_SOLO_MESSAGE =
  'This tool waits for its work, so a batch may carry only one call to it. Send this call on its own.';

/** For each request, in order, whether it is a second or later call in the batch to a tool that holds the request. */
export async function refusedInBatch(
  requests: readonly { method: string; params?: Record<string, unknown> }[]
): Promise<boolean[]> {
  const names = requests.map((r) => {
    if (r.method !== 'tools/call') return null;
    const parsed = mcpToolCallParamsSchema.safeParse(r.params);
    return parsed.success ? parsed.data.name : null;
  });
  if (names.every((n) => n === null)) return requests.map(() => false);

  const slugOf = new Map((await listMcpTools()).map((t) => [t.name, t.slug]));
  let seen = false;
  return names.map((name) => {
    const slug = name === null ? undefined : slugOf.get(name);
    if (slug === undefined || !BATCH_SOLO_SLUGS.has(slug)) return false;
    if (!seen) {
      seen = true;
      return false;
    }
    return true;
  });
}
