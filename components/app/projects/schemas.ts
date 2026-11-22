/**
 * What the projects pages read from the API (t-71), validated rather than
 * cast: a project (`lib/app/projects/wire.ts`), and the part of a framework
 * version's catalogue the defaults pickers are filled from.
 */
import { z } from 'zod';
import { projectSchema } from '@/lib/app/projects/wire';

export const PROJECTS_ENDPOINT = '/api/v1/projects';

export const projectEndpoint = (id: string): string =>
  `${PROJECTS_ENDPOINT}/${encodeURIComponent(id)}`;

export const frameworkEndpoint = (slug: string): string =>
  `/api/v1/frameworks/${encodeURIComponent(slug)}`;

export const catalogueEndpoint = (slug: string, version: string): string =>
  `${frameworkEndpoint(slug)}/versions/${encodeURIComponent(version)}/catalogue`;

/** The most a list page asks for in its one call. */
export const PROJECT_LIST_LIMIT = 100;

export { projectSchema };
export type ProjectWire = z.infer<typeof projectSchema>;

export const projectListSchema = z.array(projectSchema);

/** `GET /api/v1/frameworks/{slug}`: only the version new work uses. */
export const frameworkLatestSchema = z.object({
  name: z.string(),
  latestVersion: z.string().nullable(),
});

const idName = z.object({ id: z.string(), name: z.string() });

/**
 * The catalogue's request ids, and the reviewer sets a profile names. With the
 * culture switch off the version serves no countries, so `countries` is absent
 * and the culture picker with it.
 */
export const defaultsCatalogueSchema = z.object({
  request: z.object({
    contentTypes: z.array(idName),
    archetypes: z.array(idName),
    roles: z.array(idName),
    audience: z.array(
      idName.extend({ options: z.array(z.object({ id: z.string(), label: z.string() })) })
    ),
    countries: z.array(idName.extend({ region: z.string() })).optional(),
  }),
  result: z.object({ profiles: z.array(idName) }),
});

export type DefaultsCatalogue = z.infer<typeof defaultsCatalogueSchema>;
