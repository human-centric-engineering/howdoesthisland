/**
 * API keys (t-43): make, list and revoke your own keys for the API.
 *
 * A thin shell over core's self-service routes: `GET /api/v1/user/api-keys`
 * for the keys and the scopes this install can mint, and, in a multi-workspace
 * install, `GET /api/v1/orgs` for the active workspace, which is the one a new
 * key is bound to (§106). `ApiKeysManager` does the writes.
 *
 * Under `/settings`, which core's proxy already protects.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAuth } from '@/lib/auth/utils';
import { API } from '@/lib/api/endpoints';
import { loadServerData, requireServerData } from '@/lib/api/server-load';
import { isMultiTenant } from '@/lib/tenancy/context';
import { ApiKeysManager } from '@/components/app/settings/api-keys/api-keys-manager';
import { API_KEYS_ENDPOINT, apiKeyListSchema } from '@/components/app/settings/api-keys/schemas';
import { workspaceListSchema } from '@/components/app/workspaces/schemas';

export const metadata: Metadata = {
  title: 'API keys',
  description: 'Make, list and revoke your keys for the HowDoesThisLand API',
};

export default async function ApiKeysPage() {
  await requireAuth();

  const [loaded, orgs] = await Promise.all([
    requireServerData<unknown>(API_KEYS_ENDPOINT),
    isMultiTenant() ? loadServerData<unknown>(API.ORGS.LIST) : null,
  ]);
  const { keys, availableScopes } = apiKeyListSchema.parse(loaded.data);

  const parsedOrgs = orgs?.ok ? workspaceListSchema.safeParse(orgs.data) : null;
  const workspaceName = parsedOrgs?.success
    ? (parsedOrgs.data.orgs.find((org) => org.active)?.name ?? null)
    : null;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="hd-slug">
          <Link href="/settings" className="hover:underline">
            Settings
          </Link>
        </p>
        <h1 className="text-2xl font-bold">API keys</h1>
        <p className="text-muted-foreground">
          A key lets your own tools call the HowDoesThisLand API as you: send it as a bearer token
          in the <code>Authorization</code> header.
        </p>
      </div>

      <ApiKeysManager
        initialKeys={keys}
        availableScopes={availableScopes}
        workspaceName={workspaceName}
      />
    </div>
  );
}
