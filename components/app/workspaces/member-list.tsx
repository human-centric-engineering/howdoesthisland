/**
 * A workspace's members, as core's roster route returns them (t-8).
 * Presentational: the page loads the roster.
 */
import {
  DEFAULT_ORG_ROLE,
  ORG_ADMIN_ROLE,
  ORG_OWNER_ROLE,
  type OrgRole,
} from '@/lib/tenancy/roles';
import { Badge } from '@/components/ui/badge';
import type { WorkspaceMember } from '@/components/app/workspaces/schemas';

const ROLE_LABELS: Record<OrgRole, string> = {
  [ORG_OWNER_ROLE]: 'Owner',
  [ORG_ADMIN_ROLE]: 'Admin',
  [DEFAULT_ORG_ROLE]: 'Member',
};

export interface MemberListProps {
  members: WorkspaceMember[];
  /** The signed-in person, marked "you". */
  currentUserId: string;
}

export function MemberList({ members, currentUserId }: MemberListProps) {
  return (
    <ul className="divide-y rounded-md border">
      {members.map((member) => (
        <li key={member.id} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-medium">
              {member.name || member.email}
              {member.id === currentUserId && (
                <span className="text-muted-foreground font-normal"> (you)</span>
              )}
            </p>
            {member.name && (
              <p className="text-muted-foreground truncate text-sm">{member.email}</p>
            )}
          </div>
          <Badge variant={member.role === ORG_OWNER_ROLE ? 'default' : 'secondary'}>
            {ROLE_LABELS[member.role]}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
