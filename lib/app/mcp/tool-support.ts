/**
 * What the HowDoesThisLand MCP tools share (t-92).
 *
 * A tool call reaches a capability with no request and no session: the MCP
 * transport runs it inside the key's workspace (`runAsOrg(key.orgId)`), and
 * hands it the key's creator as `context.userId` (`protocol-handler.ts`).
 * So the tools call the same library functions as the routes, under the same
 * tenant context, and these helpers turn the parts that differ (no person,
 * refusals that would have been HTTP statuses) into tool answers.
 *
 * **Each tool is two files, and this one must stay light.** Core's
 * capability registry imports `lib/app/capabilities.ts` on every dispatch
 * path, and with it each tool class. So a class file holds only its
 * definition, its Zod schema and its redaction, and loads the work
 * (`lib/app/mcp/run/*`, which reaches the assessment service, the database
 * and the rate limiters) on its first call. A class that imported the
 * service would put all of it into the module graph of everything that can
 * dispatch, which is how the inbound-trigger route's tests broke when this
 * first landed. Nothing here may import the database client.
 */
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

/**
 * How long a tool that starts a review waits for it before answering with its
 * id and status. Below the 60 seconds many MCP clients give a tool call, so
 * the answer arrives before the client gives up on it; the review runs on
 * after the answer either way.
 */
export const MCP_WAIT_MS = 45_000;

/** A refusal a tool answers with: what an assistant can say to the person, and a code to branch on. */
export interface ToolRefusal {
  message: string;
  code: string;
}

/** What a tool's work answers: its data, or a refusal the class turns into a tool error. */
export type ToolOutcome<T> = { data: T } | { refusal: ToolRefusal };

/**
 * The person a spending tool acts for: the key's creator, or a refusal when
 * the key has none (its creator was erased). That the creator is still a
 * member of the key's workspace is checked with the work, which may read the
 * database (`lib/app/mcp/run/assess-draft.ts`).
 */
export function creatorOf(context: CapabilityContext): string | ToolRefusal {
  if (context.userId) return context.userId;
  return {
    code: 'KEY_HAS_NO_OWNER',
    message:
      'No one is behind this call (over MCP, the key’s creator no longer has an account), so it cannot start work that spends credits. Over MCP, ask a workspace owner for a new key.',
  };
}

/** A context key or value that reads as a catalogue id, not as free text. */
const CATALOGUE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/**
 * What the audit trail keeps of a context: each key and value that reads as a
 * catalogue id, and `[value]` for anything else. Recorded before the framework
 * checks the context, so a caller's free text must not pass through.
 */
export function contextShape(
  context: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (context === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      CATALOGUE_ID.test(key) ? key : '[key]',
      typeof value === 'string' && CATALOGUE_ID.test(value) ? value : '[value]',
    ])
  );
}

/** What the audit trail keeps of a draft: its size, never its words. */
export function draftShape(args: { text?: string; url?: string }): Record<string, unknown> {
  return {
    ...(args.text !== undefined ? { textChars: args.text.length } : {}),
    ...(args.url !== undefined ? { url: '[url]' } : {}),
  };
}
