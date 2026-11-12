'use client';

/**
 * Invite someone into the workspace (t-9), whether or not they have an
 * account. Posts to `POST /api/v1/workspaces/[id]/invitations`.
 *
 * The answer is the same either way, on purpose: the form must not tell an
 * admin who has an account. So the copy says what happens in both cases
 * rather than which one did. Errors are about the caller or the workspace (an
 * admin inviting an owner, a suspended workspace) and are shown as given.
 *
 * Replaces core's `MemberInviteForm` on this page, which answers 409 for an
 * address with an account.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle, Send } from 'lucide-react';
import { z } from 'zod';

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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormError, SaveError } from '@/components/forms/form-error';
import { OrgRoleHelp, ORG_ROLE_LABELS } from '@/components/admin/members/org-role-help';
import { apiClient } from '@/lib/api/client';
import { useSaveFailure } from '@/lib/hooks/use-save-failure';
import { DEFAULT_ORG_ROLE, ORG_ROLES } from '@/lib/tenancy/roles';
import { BRAND } from '@/lib/brand';
import {
  inviteToWorkspaceSchema,
  WORKSPACE_INVITATION_TTL_DAYS,
} from '@/lib/app/workspaces/validations';
import {
  sentInvitationSchema,
  workspaceInvitationsEndpoint,
} from '@/components/app/workspaces/schemas';

// The route's schema, with the role required because the form always has one.
const inviteFormSchema = inviteToWorkspaceSchema.extend({ orgRole: z.enum(ORG_ROLES) });

type InviteFormData = z.infer<typeof inviteFormSchema>;

/** Server path → the field that shows its message (`.context/ui/form-errors.md`). */
const SERVER_FIELDS: Partial<Record<string, keyof InviteFormData>> = {
  name: 'name',
  email: 'email',
};

export interface WorkspaceInviteFormProps {
  orgId: string;
}

export function WorkspaceInviteForm({ orgId }: WorkspaceInviteFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    reset,
    formState: { errors },
  } = useForm<InviteFormData>({
    resolver: zodResolver(inviteFormSchema),
    mode: 'onTouched',
    defaultValues: { name: '', email: '', orgRole: DEFAULT_ORG_ROLE },
  });
  const orgRole = watch('orgRole');
  const save = useSaveFailure({
    fallback: 'The invitation could not be sent. Try again in a moment.',
    fields: SERVER_FIELDS,
    setError,
  });

  const send = async (data: InviteFormData) => {
    setSubmitting(true);
    setSent(null);
    try {
      const response = sentInvitationSchema.parse(
        await apiClient.post<unknown>(workspaceInvitationsEndpoint(orgId), { body: data })
      );
      setSent(response.message);
      reset();
      router.refresh();
    } catch (err) {
      save.report(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Invite someone</CardTitle>
        <CardDescription>
          If they already use {BRAND.name}, they accept the invitation when they sign in. If not,
          they get an email to create an account. They appear under Members once they accept.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          method="post"
          onSubmit={save.submit(handleSubmit(send, save.invalid))}
          className="space-y-4"
          noValidate
        >
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_12rem_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="invite-name" className="flex items-center gap-1">
                Name{' '}
                <FieldHelp title="Their name">
                  <p>
                    Used to greet them in the email. If they already have an account, their own name
                    is shown instead.
                  </p>
                </FieldHelp>
              </Label>
              <Input id="invite-name" autoComplete="off" {...register('name')} />
              <FormError message={errors.name?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email" className="flex items-center gap-1">
                Email{' '}
                <FieldHelp title="Who can be invited">
                  <p>
                    Anyone. Someone with an account sees the invitation in the app for{' '}
                    {WORKSPACE_INVITATION_TTL_DAYS} days. Someone without one gets a link to create
                    an account, which works for 7 days.
                  </p>
                  <p className="mt-2">
                    You will not be told which. That way an invitation cannot be used to find out
                    who has an account.
                  </p>
                </FieldHelp>
              </Label>
              <Input id="invite-email" type="email" autoComplete="off" {...register('email')} />
              <FormError message={errors.email?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role" className="flex items-center gap-1">
                Role <OrgRoleHelp />
              </Label>
              <Select
                value={orgRole}
                onValueChange={(value) =>
                  setValue('orgRole', inviteFormSchema.shape.orgRole.parse(value))
                }
              >
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORG_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {ORG_ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={submitting}>
              <Send className="mr-2 h-4 w-4" />
              {submitting ? 'Sending…' : 'Send invitation'}
            </Button>
          </div>

          <SaveError failure={save.failure} />
        </form>

        {sent && (
          <p className="mt-4 flex items-center gap-2 text-sm" role="status">
            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
            {sent}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
