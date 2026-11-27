/**
 * A workspace's consent for HCE support to work inside it (t-97), on
 * `/settings/workspace`: whether support may enter now, the grants given,
 * and what support did under them.
 *
 * Core's own support-access components, unedited: `SupportGrantForm` posts to
 * `POST /api/v1/orgs/[id]/support-grants`, `SupportGrantsTable` revokes with
 * `DELETE …/[grantId]`, and `SupportActivityTable` reads `…/activity`. The
 * page loads the grants and hands them in. This was `/admin/support-access`
 * until t-64 closed `/admin` to platform admins.
 *
 * Who sees what follows core's rules, which the API enforces: only an OWNER
 * grants, so only an OWNER gets the form. Anyone who may see a grant may end
 * it, because ending access is always safe, so an ADMIN gets revoke too. A
 * MEMBER cannot read the grants, and is shown nothing here.
 *
 * The install workspace is the platform's own, so its staff need no grant to
 * work in it, and the API refuses one.
 *
 * "Open" (not revoked, not expired) is not the same as "support can enter".
 * Core's entry check (`verifiedSupportGrant`, `lib/tenancy/entry.ts`) also
 * needs whoever made the grant to still be an OWNER here, and the grants
 * route does not say whether that holds. So the summary checks the granter
 * against the roster the page already loaded, and claims entry only when it
 * can see they are still an owner.
 */

import { ClientDate } from '@/components/ui/client-date';
import { LoadFailedNotice } from '@/components/admin/load-failed-notice';
import { SupportActivityTable } from '@/components/admin/support-access/support-activity-table';
import { SupportGrantForm } from '@/components/admin/support-access/support-grant-form';
import {
  SupportGrantsTable,
  type SupportGrantRow,
} from '@/components/admin/support-access/support-grants-table';
import { SUPPORT_GRANT_LEVEL_LABELS } from '@/components/admin/support-access/support-level-help';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { ORG_OWNER_ROLE, orgAdministers, type OrgRole } from '@/lib/tenancy/roles';

export interface WorkspaceSupportAccessProps {
  orgId: string;
  /** The caller's role in this workspace. */
  orgRole: OrgRole;
  /** The workspace's grants, newest first; `null` when they could not be loaded. */
  grants: SupportGrantRow[] | null;
  /** The ids of this workspace's owners; `null` when the roster could not be loaded. */
  ownerIds: string[] | null;
}

/** Whether support may enter now, and on what terms. */
function OpenGrantSummary({
  grants,
  ownerIds,
}: {
  grants: SupportGrantRow[];
  ownerIds: string[] | null;
}) {
  const open = grants.find((grant) => grant.open);
  if (!open) {
    return (
      <p className="text-sm" data-testid="support-open-grant">
        Support cannot enter this workspace. Nothing is granted now.
      </p>
    );
  }
  const terms = (
    <>
      at <strong>{SUPPORT_GRANT_LEVEL_LABELS[open.level]}</strong> level until{' '}
      <ClientDate date={open.expiresAt} showTime />
    </>
  );
  // A deleted granter, or one the roster shows is no longer an owner, makes
  // the grant unusable. With no roster, say only what the grant says.
  const granterIsOwner = open.grantedBy && ownerIds ? ownerIds.includes(open.grantedBy.id) : null;
  const lapsed = open.grantedBy === null || granterIsOwner === false;
  return (
    <div className="space-y-1 text-sm" data-testid="support-open-grant">
      {lapsed ? (
        <p>
          A grant is open {terms}, but whoever made it is no longer an owner of this workspace, so
          support cannot use it. An owner can grant again to let support in.
        </p>
      ) : granterIsOwner ? (
        <p>Support can enter this workspace {terms}.</p>
      ) : (
        <p>A grant is open {terms}.</p>
      )}
      <p className="text-muted-foreground break-words whitespace-pre-wrap">Reason: {open.reason}</p>
    </div>
  );
}

export function WorkspaceSupportAccess({
  orgId,
  orgRole,
  grants,
  ownerIds,
}: WorkspaceSupportAccessProps) {
  if (!orgAdministers(orgRole)) return null;
  const isOwner = orgRole === ORG_OWNER_ROLE;

  return (
    <section aria-labelledby="support-access-heading" className="space-y-4">
      <div>
        <h2 id="support-access-heading" className="text-lg font-semibold">
          Support access
        </h2>
        <p className="text-muted-foreground text-sm">
          Whether HCE&rsquo;s support staff may work inside this workspace to help with a problem,
          and for how long. They can enter only while a grant is open.
        </p>
      </div>

      {orgId === INSTALL_ORG_ID ? (
        <p className="text-muted-foreground text-sm">
          This is the platform&rsquo;s own workspace, so its staff need no grant to work in it.
        </p>
      ) : grants ? (
        <>
          <OpenGrantSummary grants={grants} ownerIds={ownerIds} />
          {isOwner ? (
            <SupportGrantForm orgId={orgId} replacesOpenGrant={grants.some((g) => g.open)} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Only an owner of this workspace can grant support access.
              {grants.some((g) => g.open) && ' You can revoke the open grant below.'}
            </p>
          )}
          <SupportGrantsTable orgId={orgId} grants={grants} />
          {grants.length > 0 && <SupportActivityTable orgId={orgId} grants={grants} />}
        </>
      ) : (
        // No form without the list: granting replaces the open grant, and the
        // owner is told so only when the page knows there is one.
        <>
          <LoadFailedNotice what="this workspace's support grants" />
          {isOwner && (
            <p className="text-muted-foreground text-sm">
              Support access cannot be granted until they load.
            </p>
          )}
        </>
      )}
    </section>
  );
}
