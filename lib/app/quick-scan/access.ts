/**
 * Whether a quick-scan caller presents an account (t-61, t-68), once its
 * switch (`./switch.ts`) is on.
 *
 * Anyone may run the quick scan (t-68). A caller with an account (a browser
 * session, or an API key with the `assess` scope, through `withAuth`) gets the
 * full result; anyone else gets the scores and a caveat (`./summary.ts`).
 */
import type { NextRequest } from 'next/server';
import { API_KEY_PREFIX } from '@/lib/auth/api-keys';
import { auth } from '@/lib/auth/config';

/**
 * Whether the caller presents an account: an API key in the `Authorization`
 * header, or a browser session. Such a caller goes through `withAuth`, which
 * decides whether the key or session may act (its scope, its workspace).
 * A key is recognised by its header, not looked up, so the guard looks it up
 * once; a key the guard then refuses is refused, never answered as anonymous.
 * The session is asked of better-auth directly, not through
 * `getServerSession()`, which answers a failed lookup as "no session": a
 * member whose lookup fails gets the 500, not the anonymous answer. The guard
 * then looks the session up again: a second read, accepted because
 * better-auth's cookie cache (`lib/auth/config.ts`, five minutes) answers it
 * without the database, and `withAuth` takes no session from outside.
 */
export async function presentsAccount(request: NextRequest): Promise<boolean> {
  if (presentsApiKey(request)) return true;
  return (await auth.api.getSession({ headers: request.headers })) !== null;
}

/** Whether the caller sends an API key, by its header alone. */
export function presentsApiKey(request: Request): boolean {
  return request.headers.get('authorization')?.startsWith(`Bearer ${API_KEY_PREFIX}`) ?? false;
}
