/**
 * What the share-link routes accept (t-32). The route registry imports these,
 * so the contract is the handlers' own schemas.
 */
import { z } from 'zod';

/** How long a link lives when the caller does not say. */
export const DEFAULT_SHARE_DAYS = 30;

/** The longest a link may be made to live. */
export const MAX_SHARE_DAYS = 365;

/** `POST /api/v1/assessments/{id}/shares`. An empty body takes the default. */
export const createShareSchema = z.object({
  expiresInDays: z.number().int().min(1).max(MAX_SHARE_DAYS).default(DEFAULT_SHARE_DAYS),
});

export type CreateShareInput = z.infer<typeof createShareSchema>;

/** `DELETE /api/v1/shares/{id}`. */
export const shareIdParamSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `GET /api/v1/shared-reports/{token}`. Any string up to a sane length: a
 * token of the wrong shape is not found, like a wrong one, not a 400 that
 * would tell a guesser the shape.
 */
export const shareTokenParamSchema = z.object({ token: z.string().min(1).max(128) });
