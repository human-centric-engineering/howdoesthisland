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
