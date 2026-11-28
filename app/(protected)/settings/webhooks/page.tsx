/**
 * Webhooks (t-100): the active workspace's webhooks, for its owners and
 * admins. Add one, switch it on or off, give it a new secret, delete it, and
 * read its recent deliveries.
 *
 * A thin shell over the API: `GET /api/v1/orgs` for the active workspace and
 * the caller's role in it, t-99's `GET /api/v1/workspaces/[id]/event-subscriptions`
 * for the webhooks (each with its last delivery, so no row fetches its own),
 * and `GET /api/v1/projects` for the projects one can be limited to.
 * `WebhooksManager` does the writes, through t-99's routes only.
 *
 * This page adds no rule of its own: the routes admit a workspace's `OWNER`
 * or `ADMIN` and nobody else. A `MEMBER` is told who to ask, and the
 * webhooks are never loaded for them. Not found at `TENANCY_MODE=single`,
 * where the routes answer `WORKSPACES_UNAVAILABLE`.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth/utils';
import { API } from '@/lib/api/endpoints';
import { loadServerData, requireServerData } from '@/lib/api/server-load';
import { isMultiTenant } from '@/lib/tenancy/context';
import { orgAdministers } from '@/lib/tenancy/roles';
import { LoadFailedNotice } from '@/components/admin/load-failed-notice';
import { workspaceListSchema } from '@/components/app/workspaces/schemas';
import { PROJECT_LIST_LIMIT, PROJECTS_ENDPOINT } from '@/components/app/projects/schemas';
import { WebhooksManager } from '@/components/app/settings/webhooks/webhooks-manager';
import {
  projectChoiceListSchema,
  subscriptionListSchema,
  subscriptionsEndpoint,
} from '@/components/app/settings/webhooks/schemas';
import { WEBHOOKS_DOCS_HREF } from '@/components/app/developers/webhooks';

/**
 * The workspace's settings page. Not `WORKSPACE_SETTINGS_HREF`: that lives in
 * a client module, whose exports a server component reads as references.
 */
const WORKSPACE_SETTINGS_PATH = '/settings/workspace';

export const metadata: Metadata = {
  title: 'Webhooks',
  description:
    'Send a signed message to your own systems each time a review or comparison finishes',
};

export default async function WebhooksPage() {
  if (!isMultiTenant()) notFound();
  await requireAuth();

  const orgs = await requireServerData<unknown>(API.ORGS.LIST);
  const active = workspaceListSchema.parse(orgs.data).orgs.find((org) => org.active);

  const heading = (
    <div className="space-y-2">
      <p className="hd-slug">
        <Link href={WORKSPACE_SETTINGS_PATH} className="hover:underline">
          {active ? active.name : 'Workspace'}
        </Link>
      </p>
      <h1 className="text-2xl font-bold">Webhooks</h1>
      <p className="text-muted-foreground">
        Each time a review or a comparison in this workspace finishes, a webhook sends a signed
        message to an address of yours, such as your CMS, so it need not keep asking.{' '}
        <Link href={WEBHOOKS_DOCS_HREF} className="underline underline-offset-2">
          How to receive one
        </Link>
        .
      </p>
    </div>
  );

  if (!active) {
    return (
      <div className="space-y-8">
        {heading}
        <p className="text-muted-foreground">
          You are not in a workspace right now. Choose one from the switcher at the top of the page.
        </p>
      </div>
    );
  }

  if (!orgAdministers(active.role)) {
    return (
      <div className="space-y-8">
        {heading}
        <p className="text-muted-foreground">
          Only the workspace&rsquo;s owners and admins can see and change its webhooks. Ask one of
          them.
        </p>
      </div>
    );
  }

  const [loaded, loadedProjects] = await Promise.all([
    loadServerData<unknown>(subscriptionsEndpoint(active.id)),
    loadServerData<unknown>(`${PROJECTS_ENDPOINT}?limit=${PROJECT_LIST_LIMIT}`),
  ]);
  const parsed = loaded.ok ? subscriptionListSchema.safeParse(loaded.data) : null;
  const parsedProjects = loadedProjects.ok
    ? projectChoiceListSchema.safeParse(loadedProjects.data)
    : null;

  return (
    <div className="space-y-8">
      {heading}
      {parsed?.success ? (
        <WebhooksManager
          orgId={active.id}
          initialSubscriptions={parsed.data.subscriptions}
          // Without the projects, a webhook can still cover the whole workspace.
          projects={parsedProjects?.success ? parsedProjects.data : []}
        />
      ) : (
        <LoadFailedNotice what="this workspace's webhooks" />
      )}
    </div>
  );
}
