/**
 * The shapes the workspace UI reads from core's org routes and the app's
 * workspace route, validated rather than cast (t-8). Fields the UI does not
 * use are left out; zod drops them.
 */
import { z } from 'zod';
import { ORG_ROLES, ORG_STATUSES } from '@/lib/tenancy/roles';
import { emailSchema } from '@/lib/validations/auth';

/** One row of `GET /api/v1/orgs`. */
export const workspaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(ORG_STATUSES),
  role: z.enum(ORG_ROLES),
  active: z.boolean(),
});

export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;

/** `GET /api/v1/orgs` data. */
export const workspaceListSchema = z.object({
  activeOrgId: z.string().nullable(),
  orgs: z.array(workspaceSummarySchema),
});

export type WorkspaceList = z.infer<typeof workspaceListSchema>;

/** `POST /api/v1/workspaces` data. */
export const createdWorkspaceSchema = z.object({ id: z.string(), name: z.string() });

/** One row of `GET /api/v1/orgs/[id]/members`. */
export const workspaceMemberSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  role: z.enum(ORG_ROLES),
  joinedAt: z.coerce.date(),
});

export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

/** `GET /api/v1/orgs/[id]/members` data. */
export const workspaceMembersSchema = z.object({ members: z.array(workspaceMemberSchema) });

/** The invite form. Mirrors core's `inviteOrgMemberSchema`. */
export const inviteFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters'),
  email: emailSchema,
  orgRole: z.enum(ORG_ROLES),
});

export type InviteForm = z.infer<typeof inviteFormSchema>;

/** What core's invitation route says about the email, on 201 or a 200 "already pending". */
export const inviteResultSchema = z.object({
  emailStatus: z.enum(['sent', 'failed', 'disabled', 'pending']),
});

export type InviteEmailStatus = z.infer<typeof inviteResultSchema>['emailStatus'];
