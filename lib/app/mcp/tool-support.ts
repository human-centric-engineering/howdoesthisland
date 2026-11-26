/**
 * What the HowDoesThisLand MCP tools share (t-92).
 *
 * A tool call reaches a capability with no request and no session: the MCP
 * transport runs it inside the key's workspace (`runAsOrg(key.orgId)`), and
 * hands it the key's creator as `context.userId` (`protocol-handler.ts`).
 * So the tools call the same library functions as the routes, under the same
 * tenant context, and these helpers turn the parts that differ (no person,
 * refusals that would have been HTTP statuses) into tool answers.
 */
import { APIError } from '@/lib/api/errors';
import { WorkspaceBusyError } from '@/lib/app/assessments/places';
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

/** The person a spending tool acts for: the key's creator, or a refusal when the key has none. */
export function creatorOf(context: CapabilityContext): string | ToolRefusal {
  if (context.userId) return context.userId;
  return {
    code: 'KEY_HAS_NO_OWNER',
    message:
      'This MCP key no longer belongs to anyone in the workspace, so it cannot start work that spends credits. Ask a workspace owner for a new key.',
  };
}

export function isRefusal(value: unknown): value is ToolRefusal {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

const issueList = (details: Record<string, unknown> | undefined): string[] => {
  const errors = details?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((e: unknown) => {
    if (typeof e !== 'object' || e === null) return [];
    const path: unknown = Reflect.get(e, 'path');
    const message: unknown = Reflect.get(e, 'message');
    if (typeof message !== 'string') return [];
    return [typeof path === 'string' && path !== '' ? `${path}: ${message}` : message];
  });
};

/**
 * A library refusal as a tool answer, or `null` for anything else, which the
 * caller rethrows so the dispatcher logs it and answers its generic
 * `execution_error`. The library's messages are already written for the
 * person asking (they are the API's), so they pass through as they are.
 */
export function refusalOf(err: unknown): ToolRefusal | null {
  if (err instanceof WorkspaceBusyError) {
    return { code: 'WORKSPACE_BUSY', message: err.message };
  }
  if (err instanceof APIError) {
    const issues = issueList(err.details);
    return {
      code: err.code ?? 'REFUSED',
      message: issues.length > 0 ? `${err.message}: ${issues.join('; ')}` : err.message,
    };
  }
  return null;
}

/** What the audit trail keeps of a draft: its size, never its words. */
export function draftShape(args: { text?: string; url?: string }): Record<string, unknown> {
  return {
    ...(args.text !== undefined ? { textChars: args.text.length } : {}),
    ...(args.url !== undefined ? { url: '[url]' } : {}),
  };
}
