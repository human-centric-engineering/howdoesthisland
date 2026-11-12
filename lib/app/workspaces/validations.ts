/**
 * Request schemas and limits for the workspace routes (t-8). Client-safe.
 */
import { z } from 'zod';

/**
 * How many workspaces one person may own, their signup workspace included.
 * Here rather than beside the cap's check so the UI can say it without
 * importing the database client.
 */
export const MAX_OWNED_WORKSPACES = 10;

/** `POST /api/v1/workspaces` body. */
export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or fewer'),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

/** How long an invitation into a workspace stays open (t-9). */
export const WORKSPACE_INVITATION_TTL_DAYS = 14;

/**
 * `POST /api/v1/workspaces/[id]/invitations` body: core's org-invitation
 * shape, so the same name / email / role reach either path behind it. The name
 * is used only when the address has no account (core's sign-up invitation
 * greets them by it); the form cannot know which, so it always asks.
 */
export { inviteOrgMemberSchema as inviteToWorkspaceSchema } from '@/lib/validations/tenancy';

/** `[invitationId]` route segment. */
export const invitationIdParamSchema = z.object({
  invitationId: z.string().trim().min(1).max(64),
});
