/**
 * Workspace settings (t-8): who is in the active workspace, and inviting
 * someone new into it.
 *
 * Reads core's routes, as the rest of the app does: `GET /api/v1/orgs` for
 * the active workspace and the caller's role in it, then
 * `GET /api/v1/orgs/[id]/members` for the roster. Core lets an `OWNER` or
 * `ADMIN` read the roster and invite, and nobody else, so a `MEMBER` is told
 * who to ask instead of being shown a 403.
 *
 * Not found at `TENANCY_MODE=single`, where there is one shared org and the
 * platform admin manages its users on `/admin/users`.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth/utils';
import { API } from '@/lib/api/endpoints';
import { loadServerData, requireServerData } from '@/lib/api/server-load';
import { isMultiTenant } from '@/lib/tenancy/context';
import { ORG_OWNER_ROLE, orgAdministers } from '@/lib/tenancy/roles';
import { LoadFailedNotice } from '@/components/admin/load-failed-notice';
import { InviteMemberForm } from '@/components/app/workspaces/invite-member-form';
import { MemberList } from '@/components/app/workspaces/member-list';
import {
  workspaceListSchema,
  workspaceMembersSchema,
  type WorkspaceMember,
} from '@/components/app/workspaces/schemas';

export const metadata: Metadata = {
  title: 'Workspace settings',
  description: 'Members of this workspace, and inviting people into it',
};

export default async function WorkspaceSettingsPage() {
  if (!isMultiTenant()) notFound();
  const session = await requireAuth();

  const { data } = await requireServerData<unknown>(API.ORGS.LIST);
  const active = workspaceListSchema.parse(data).orgs.find((org) => org.active);

  if (!active) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Workspace settings</h1>
        <p className="text-muted-foreground">
          You are not in a workspace right now. Choose one from the switcher at the top of the page.
        </p>
      </div>
    );
  }

  const administers = orgAdministers(active.role);
  let members: WorkspaceMember[] | null = null;
  if (administers) {
    const loaded = await loadServerData<unknown>(API.ORGS.members(active.id));
    const parsed = loaded.ok ? workspaceMembersSchema.safeParse(loaded.data) : null;
    members = parsed?.success ? parsed.data.members : null;
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="hd-slug">Workspace</p>
        <h1 className="text-2xl font-bold">{active.name}</h1>
        <p className="text-muted-foreground">Who is in this workspace, and inviting people in.</p>
      </div>

      {administers ? (
        <>
          <section aria-labelledby="members-heading" className="space-y-3">
            <h2 id="members-heading" className="text-lg font-semibold">
              Members
            </h2>
            {members ? (
              <MemberList members={members} currentUserId={session.user.id} />
            ) : (
              <LoadFailedNotice what="the members of this workspace" />
            )}
          </section>
          <section aria-labelledby="invite-heading" className="max-w-2xl space-y-3">
            <h2 id="invite-heading" className="text-lg font-semibold">
              Invite someone
            </h2>
            <InviteMemberForm orgId={active.id} canInviteOwner={active.role === ORG_OWNER_ROLE} />
          </section>
        </>
      ) : (
        <p className="text-muted-foreground">
          Only the workspace&rsquo;s owners and admins can see its members and invite people. Ask
          one of them to add someone.
        </p>
      )}
    </div>
  );
}
