'use client';

/**
 * Invite someone new into a workspace (t-8), through core's
 * `POST /api/v1/orgs/[id]/invitations`. The invitation goes to them by email;
 * they join when they accept it and create their account.
 *
 * Core refuses an address that already has an account (409 `EMAIL_TAKEN`).
 * Inviting existing accounts is t-9; until then the refusal is shown as the
 * route words it.
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Info, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { API } from '@/lib/api/endpoints';
import { useSaveFailure } from '@/lib/hooks/use-save-failure';
import {
  DEFAULT_ORG_ROLE,
  ORG_ADMIN_ROLE,
  ORG_OWNER_ROLE,
  type OrgRole,
} from '@/lib/tenancy/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldHelp } from '@/components/ui/field-help';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormError, SaveError } from '@/components/forms/form-error';
import {
  inviteFormSchema,
  inviteResultSchema,
  type InviteEmailStatus,
  type InviteForm,
} from '@/components/app/workspaces/schemas';

const SERVER_FIELDS: Partial<Record<string, keyof InviteForm>> = {
  name: 'name',
  email: 'email',
  orgRole: 'orgRole',
};

const ROLE_LABELS: Record<OrgRole, string> = {
  [DEFAULT_ORG_ROLE]: 'Member',
  [ORG_ADMIN_ROLE]: 'Admin',
  [ORG_OWNER_ROLE]: 'Owner',
};

export interface InviteMemberFormProps {
  orgId: string;
  /** Only an owner may invite someone as an owner (core's rule). */
  canInviteOwner: boolean;
}

export function InviteMemberForm({ orgId, canInviteOwner }: InviteMemberFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [outcome, setOutcome] = useState<{ email: string; status: InviteEmailStatus } | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<InviteForm>({
    resolver: zodResolver(inviteFormSchema),
    mode: 'onTouched',
    defaultValues: { name: '', email: '', orgRole: DEFAULT_ORG_ROLE },
  });
  const save = useSaveFailure({
    fallback: 'Could not send the invitation. Try again in a moment.',
    fields: SERVER_FIELDS,
    setError,
  });
  const role = watch('orgRole');
  const roles: OrgRole[] = canInviteOwner
    ? [DEFAULT_ORG_ROLE, ORG_ADMIN_ROLE, ORG_OWNER_ROLE]
    : [DEFAULT_ORG_ROLE, ORG_ADMIN_ROLE];

  const onSubmit = async (data: InviteForm) => {
    setIsLoading(true);
    setOutcome(null);
    try {
      const result = inviteResultSchema.safeParse(
        await apiClient.post<unknown>(API.ORGS.invitations(orgId), { body: data })
      );
      // An answer this form cannot read was still a success: say it was sent.
      setOutcome({ email: data.email, status: result.success ? result.data.emailStatus : 'sent' });
      reset();
    } catch (err) {
      save.report(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form
      method="post"
      noValidate
      onSubmit={save.submit(handleSubmit(onSubmit, save.invalid))}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="invite-name">Name</Label>
          <Input id="invite-name" autoComplete="off" disabled={isLoading} {...register('name')} />
          <FormError message={errors.name?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-email" className="flex items-center gap-1">
            Email
            <FieldHelp title="Who to invite">
              The invitation is emailed here, and they join when they accept it and create their
              account. Someone who already has an account cannot be invited this way yet.
            </FieldHelp>
          </Label>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            disabled={isLoading}
            {...register('email')}
          />
          <FormError message={errors.email?.message} />
        </div>
      </div>
      <div className="space-y-2 sm:max-w-[16rem]">
        <Label htmlFor="invite-role" className="flex items-center gap-1">
          Role
          <FieldHelp title="Their role in this workspace">
            Members work on the workspace&rsquo;s projects. Admins can also see who is in it and
            invite people. Owners can do everything, including appointing other owners. Defaults to
            Member.
          </FieldHelp>
        </Label>
        <Select
          value={role}
          onValueChange={(value) => {
            const picked = roles.find((r) => r === value);
            if (picked) setValue('orgRole', picked, { shouldValidate: true });
          }}
          disabled={isLoading}
        >
          <SelectTrigger id="invite-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FormError message={errors.orgRole?.message} />
      </div>
      {outcome && <InviteOutcome email={outcome.email} status={outcome.status} />}
      <SaveError failure={save.failure} />
      <Button type="submit" disabled={isLoading}>
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Sending…
          </>
        ) : (
          'Send invitation'
        )}
      </Button>
    </form>
  );
}

/**
 * What happened to the invitation. Not a failed save: the invitation exists
 * in every case, so a missed email is said as a notice, not as an error.
 */
function InviteOutcome({ email, status }: { email: string; status: InviteEmailStatus }) {
  if (status === 'sent') {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        Invitation sent to {email}.
      </p>
    );
  }
  return (
    <p role="status" className="text-muted-foreground flex items-start gap-2 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {status === 'pending'
        ? `${email} already has an invitation to this workspace waiting.`
        : `The invitation to ${email} is saved, but the email could not be sent. A platform admin can resend it.`}
    </p>
  );
}
