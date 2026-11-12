'use client';

/**
 * The signed-in person's open invitations into other workspaces (t-9), each
 * with Accept and Decline.
 *
 * The list comes from the page (`GET /api/v1/workspaces/invitations`, read on
 * the server). Accepting calls `POST …/[id]/accept`, then switches into the
 * workspace with core's `POST /api/v1/orgs/switch`, since that is almost
 * always what someone accepting wants next. If the switch fails they are
 * still a member, and the switcher offers it. Declining calls `…/decline`.
 * Either way the answered invitation leaves the list and the page refreshes.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SaveError } from '@/components/forms/form-error';
import { ORG_ROLE_LABELS } from '@/components/admin/members/org-role-help';
import { apiClient } from '@/lib/api/client';
import { API } from '@/lib/api/endpoints';
import { useSaveFailure } from '@/lib/hooks/use-save-failure';
import {
  acceptedInvitationSchema,
  answerInvitationEndpoint,
  type InvitationForInvitee,
} from '@/components/app/workspaces/schemas';

export interface WorkspaceInvitationsProps {
  invitations: InvitationForInvitee[];
}

const expiryFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });

export function WorkspaceInvitations({ invitations }: WorkspaceInvitationsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const save = useSaveFailure({ fallback: 'That did not work. Try again in a moment.' });

  const open = invitations.filter((invitation) => !answered.has(invitation.id));
  // Kept while it has an error to show: a failed answer refreshes the page,
  // and when that empties the list the message would go with it.
  if (open.length === 0 && !save.failure) return null;

  const answer = async (invitation: InvitationForInvitee, choice: 'accept' | 'decline') => {
    save.clear();
    setBusy(invitation.id);
    try {
      const data = await apiClient.post<unknown>(answerInvitationEndpoint(invitation.id, choice));
      setAnswered((previous) => new Set(previous).add(invitation.id));
      if (choice === 'accept') {
        const { orgId } = acceptedInvitationSchema.parse(data);
        // Joined either way; a failed switch leaves them where they were.
        await apiClient.post<unknown>(API.ORGS.SWITCH, { body: { orgId } }).catch(() => null);
      }
      router.refresh();
    } catch (err) {
      save.report(err);
      // A 409 / 410 means it can no longer be answered: drop it from the list.
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card aria-labelledby="invitations-heading">
      <CardHeader>
        <CardTitle id="invitations-heading" className="text-lg">
          Invitations to you
        </CardTitle>
        <CardDescription>
          Accepting adds you to the workspace and switches you into it. Your other workspaces stay
          as they are.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y">
          {open.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div>
                <p className="font-medium">{invitation.workspace.name}</p>
                <p className="text-muted-foreground text-sm">
                  As {ORG_ROLE_LABELS[invitation.role].toLowerCase()}
                  {invitation.invitedBy ? `, from ${invitation.invitedBy}` : ''}. Open until{' '}
                  {expiryFormat.format(new Date(invitation.expiresAt))}.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void answer(invitation, 'accept')}
                  aria-label={`Accept the invitation to ${invitation.workspace.name}`}
                >
                  <Check className="mr-1 h-4 w-4" />
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void answer(invitation, 'decline')}
                  aria-label={`Decline the invitation to ${invitation.workspace.name}`}
                >
                  <X className="mr-1 h-4 w-4" />
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <SaveError failure={save.failure} />
      </CardContent>
    </Card>
  );
}
