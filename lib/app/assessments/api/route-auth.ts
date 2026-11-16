/**
 * What every `assessments` route hands the guard (t-24).
 *
 * The routes take a browser session or an API key with the `assess` scope.
 * An assessment is the workspace's: any member acting in it may read,
 * cancel or delete one, and the guard's tenant context is the boundary, so
 * the routes decide no ownership of their own.
 */
import type { AuthSession, WithAuthOptions } from '@/lib/auth/guards';
import { API_KEY_SESSION_ID_PREFIX, isApiKeySession } from '@/lib/auth/api-keys';

/** The API-key scope these routes enforce (`lib/app/api-key-scopes.ts`). */
export const ASSESS_SCOPE = 'assess';

/**
 * The API-key scope the report's PDF enforces (t-31). Separate from `assess`
 * so a key that only fetches reports, for a script that files them, cannot
 * start runs that spend. Read-only: making or revoking a share link (t-32),
 * which publishes a report, needs `assess`.
 */
export const REPORTS_SCOPE = 'reports';

/** The guard options every `assessments` route passes, with the scope it enforces. */
export function assessRoute<TParams = Record<string, string>>(
  scope: typeof ASSESS_SCOPE | typeof REPORTS_SCOPE = ASSESS_SCOPE
): WithAuthOptions<TParams> {
  return {
    scope,
    ownership: {
      decidedBy: 'nothing',
      because:
        "Assessments are the workspace's, not a person's: every read and write names the org the guard entered, so another workspace's id is not found.",
    },
  };
}

/**
 * The id of the API key a request came through, or `null` for a browser
 * session: read off the synthetic session `resolveApiKey` mints, so the key
 * is not looked up a second time.
 */
export function apiKeyIdOf(session: AuthSession): string | null {
  return isApiKeySession(session)
    ? session.session.id.slice(API_KEY_SESSION_ID_PREFIX.length)
    : null;
}
