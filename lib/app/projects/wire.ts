/**
 * A project as the `projects` routes answer with it (t-70). The registry's
 * response schemas; a type test holds them against what the service returns.
 */
import { z } from 'zod';
import { briefSchema, projectDefaultsSchema } from '@/lib/app/projects/validations';

/** One project. Times are ISO strings on the wire. */
export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  brief: briefSchema,
  defaults: projectDefaultsSchema,
  /** The framework its reviews are scored with, by slug. */
  framework: z.string(),
  archived: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  /** Reviews kept in it, stored ones only. */
  reviewCount: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** What the service returns: as {@link projectSchema}, with `Date`s. */
export interface ProjectView {
  id: string;
  name: string;
  brief: z.infer<typeof briefSchema>;
  defaults: z.infer<typeof projectDefaultsSchema>;
  framework: string;
  archived: boolean;
  archivedAt: Date | null;
  reviewCount: number;
  createdAt: Date;
  updatedAt: Date;
}
