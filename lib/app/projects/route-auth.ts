/**
 * What every `projects` route hands the guard (t-70).
 *
 * The routes take a browser session or an API key with the `projects` scope.
 * A project is the workspace's: any member acting in it may read, change or
 * archive one, and the guard's tenant context is the boundary, so the routes
 * decide no ownership of their own.
 */
import type { WithAuthOptions } from '@/lib/auth/guards';

/** The API-key scope these routes enforce (`lib/app/api-key-scopes.ts`). */
export const PROJECTS_SCOPE = 'projects';

/** The guard options every `projects` route passes. */
export function projectsRoute<TParams = Record<string, string>>(): WithAuthOptions<TParams> {
  return {
    scope: PROJECTS_SCOPE,
    ownership: {
      decidedBy: 'nothing',
      because:
        "Projects are the workspace's, not a person's: every read and write names the org the guard entered, so another workspace's id is not found.",
    },
  };
}
