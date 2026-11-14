/**
 * Path-segment schemas for the public `frameworks` routes (t-11). Client-safe:
 * no database import, so the route registry (`lib/app/api/registry.ts`) can
 * declare them without loading the service.
 *
 * The service checks each segment before any query. A segment that fails
 * cannot name a record, so it answers the same 404 a well-formed unknown value
 * gets, not a 400.
 */
import { z } from 'zod';

export const slugParam = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

export const versionParam = z
  .string()
  .max(64)
  .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);

export const kindParam = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
