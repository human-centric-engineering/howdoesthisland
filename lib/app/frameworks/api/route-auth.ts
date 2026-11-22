/**
 * Who may read the `frameworks` routes (t-67).
 *
 * The model is HowDoesThisLand's IP (owner ruling, 2026-11-22), so it is
 * never served to the public:
 * - **The whole model and its kinds** are for platform admins only
 *   ({@link MODEL_ADMIN_ONLY}). Reports read it in process, not over HTTP.
 * - **The list, a framework's versions and a version's catalogue** (the ids
 *   and names a review takes and returns) are for a browser session or an
 *   API key with the `assess` scope ({@link frameworkReader}): what someone
 *   building review requests needs.
 */
import type { WithAuthOptions } from '@/lib/auth/guards';
import { ASSESS_SCOPE } from '@/lib/app/assessments/api/route-auth';

const ownership = {
  decidedBy: 'nothing',
  because:
    'A framework is shared config, owned by no user or workspace; the guard decides only who may read it.',
} as const;

/** The whole model, and one kind of its records: platform admins only. */
export const MODEL_ADMIN_ONLY = { ownership } as const;

/** The list, a framework's versions and a version's catalogue: a session or an `assess` key. */
export function frameworkReader<TParams = Record<string, string>>(): WithAuthOptions<TParams> {
  return { scope: ASSESS_SCOPE, ownership };
}
