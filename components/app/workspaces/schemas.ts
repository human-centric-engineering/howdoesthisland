/**
 * The shapes the workspace UI reads from core's org routes and the app's
 * workspace route, validated rather than cast (t-8). Fields the UI does not
 * use are left out; zod drops them.
 */
import { z } from 'zod';
import { ORG_ROLES, ORG_STATUSES } from '@/lib/tenancy/roles';

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
  // Only `orgs`: both readers take the active one from `orgs[].active`, so a
  // field neither reads must not be able to fail the parse.
  orgs: z.array(workspaceSummarySchema),
});

export type WorkspaceList = z.infer<typeof workspaceListSchema>;

/** `POST /api/v1/workspaces` data. */
export const createdWorkspaceSchema = z.object({ id: z.string(), name: z.string() });

/** One row of `GET /api/v1/orgs/[id]/members`, in the shape core's `MembersTable` takes. */
export const workspaceMemberSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  role: z.enum(ORG_ROLES),
  joinedAt: z.string(),
});

/** `GET /api/v1/orgs/[id]/members` data. */
export const workspaceMembersSchema = z.object({ members: z.array(workspaceMemberSchema) });
