/**
 * A library refusal as a tool answer (t-92). Loaded with a tool's work, not
 * with its class: `WorkspaceBusyError` comes from a module that holds the
 * database client (see `lib/app/mcp/tool-support.ts`).
 */
import { APIError } from '@/lib/api/errors';
import { WorkspaceBusyError } from '@/lib/app/assessments/places';
import type { ToolRefusal } from '@/lib/app/mcp/tool-support';

/**
 * The fields a refusal names. A validation error lists them under `errors`;
 * `contextFor`'s `CONTEXT_INVALID` lists them under `issues`.
 */
const issueList = (details: Record<string, unknown> | undefined): string[] => {
  const errors = Array.isArray(details?.errors) ? details.errors : details?.issues;
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
 * The refusal, or `null` for anything else, which the caller rethrows so the
 * dispatcher logs it and answers its generic `execution_error`. The library's
 * messages are already written for the person asking (they are the API's), so
 * they pass through as they are.
 */
export function refusalOf(err: unknown): ToolRefusal | null {
  if (err instanceof WorkspaceBusyError) {
    return { code: 'WORKSPACE_BUSY', message: err.message };
  }
  if (err instanceof APIError) {
    const issues = issueList(err.details);
    return {
      code: err.code ?? 'REFUSED',
      message:
        issues.length > 0 ? `${err.message.replace(/\.$/, '')}: ${issues.join('; ')}` : err.message,
    };
  }
  return null;
}
