/**
 * Workspace settings (t-8, t-9, j4): the caller's own invitations into other
 * workspaces, who is in the active workspace, inviting people into it, and
 * which model each judge and the editor runs on.
 *
 * A thin shell over the API: `GET /api/v1/workspaces/invitations` for the
 * caller's invitations, `GET /api/v1/orgs` for the active workspace and the
 * caller's role in it, `GET /api/v1/orgs/[id]/members` for the roster, and
 * core's own `MembersTable` (role change, removal), the component core's
 * `/admin/members` uses. Inviting is the app's `WorkspaceInviteForm` (t-9)
 * rather than core's `MemberInviteForm`, which answers 409 for an address
 * with an account and so tells an admin who has one; the app's route invites
 * both and answers the same either way. Judge models are the app's
 * `GET /api/v1/workspaces/[id]/judges`, shown by `JudgeModels`.
 *
 * This page adds no rule of its own: the API decides who may do what. Core
 * lets an `OWNER` or `ADMIN` read the roster and invite, and nobody else, so
 * a `MEMBER` is told who to ask instead of being shown a 403. Invitations to
 * the caller show for everyone, in a workspace or not: the invitation email
 * links here.
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
import { orgAdministers } from '@/lib/tenancy/roles';
import { LoadFailedNotice } from '@/components/admin/load-failed-notice';
import { MembersTable, type OrgMember } from '@/components/admin/members/members-table';
import { WorkspaceInviteForm } from '@/components/app/workspaces/workspace-invite-form';
import { WorkspaceInvitations } from '@/components/app/workspaces/workspace-invitations';
import { JudgeModels } from '@/components/app/settings/judge-models';
import { judgeModelListSchema, judgeModelsEndpoint } from '@/components/app/settings/schemas';
import type { JudgeModelChoiceView } from '@/components/app/settings/schemas';
import {
  myInvitationsSchema,
  WORKSPACE_INVITATIONS_ENDPOINT,
  workspaceListSchema,
  workspaceMembersSchema,
} from '@/components/app/workspaces/schemas';

export const metadata: Metadata = {
  title: 'Workspace settings',
  description: 'Members of this workspace, inviting people into it, and invitations to you',
};

export default async function WorkspaceSettingsPage() {
  if (!isMultiTenant()) notFound();
  const session = await requireAuth();

  const [orgs, mine] = await Promise.all([
    requireServerData<unknown>(API.ORGS.LIST),
    loadServerData<unknown>(WORKSPACE_INVITATIONS_ENDPOINT),
  ]);
  const active = workspaceListSchema.parse(orgs.data).orgs.find((org) => org.active);
  const parsedInvitations = mine.ok ? myInvitationsSchema.safeParse(mine.data) : null;
  const invitations = parsedInvitations?.success ? parsedInvitations.data.invitations : null;

  const invitationsSection = invitations ? (
    <WorkspaceInvitations invitations={invitations} />
  ) : (
    <LoadFailedNotice what="your invitations" />
  );

  if (!active) {
    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Workspace settings</h1>
          <p className="text-muted-foreground">
            You are not in a workspace right now. Choose one from the switcher at the top of the
            page.
          </p>
        </div>
        {invitationsSection}
      </div>
    );
  }

  const administers = orgAdministers(active.role);
  let members: OrgMember[] | null = null;
  let judges: JudgeModelChoiceView[] | null = null;
  if (administers) {
    const [loaded, loadedJudges] = await Promise.all([
      loadServerData<unknown>(API.ORGS.members(active.id)),
      loadServerData<unknown>(judgeModelsEndpoint(active.id)),
    ]);
    const parsed = loaded.ok ? workspaceMembersSchema.safeParse(loaded.data) : null;
    members = parsed?.success ? parsed.data.members : null;
    const parsedJudges = loadedJudges.ok ? judgeModelListSchema.safeParse(loadedJudges.data) : null;
    judges = parsedJudges?.success ? parsedJudges.data.agents : null;
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="hd-slug">Workspace</p>
        <h1 className="text-2xl font-bold">{active.name}</h1>
        <p className="text-muted-foreground">
          Who is in this workspace, their roles, inviting people in, and the models its judges use.
        </p>
      </div>

      {invitationsSection}

      {administers ? (
        <>
          <WorkspaceInviteForm orgId={active.id} />
          <section aria-labelledby="members-heading" className="space-y-3">
            <h2 id="members-heading" className="text-lg font-semibold">
              Members
            </h2>
            {members ? (
              <MembersTable orgId={active.id} members={members} currentUserId={session.user.id} />
            ) : (
              <LoadFailedNotice what="the members of this workspace" />
            )}
          </section>
          {judges ? (
            <JudgeModels orgId={active.id} agents={judges} />
          ) : (
            <LoadFailedNotice what="the judge models" />
          )}
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
