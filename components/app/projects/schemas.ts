/**
 * What the projects pages read from the API (t-71), validated rather than
 * cast: a project (`lib/app/projects/wire.ts`), and the part of a framework
 * version's catalogue the defaults pickers and the weights section (t-72) are
 * filled from.
 */
import { z } from 'zod';
import { projectDocumentSchema, projectSchema } from '@/lib/app/projects/wire';

export const PROJECTS_ENDPOINT = '/api/v1/projects';

export const projectEndpoint = (id: string): string =>
  `${PROJECTS_ENDPOINT}/${encodeURIComponent(id)}`;

export const frameworkEndpoint = (slug: string): string =>
  `/api/v1/frameworks/${encodeURIComponent(slug)}`;

export const catalogueEndpoint = (slug: string, version: string): string =>
  `${frameworkEndpoint(slug)}/versions/${encodeURIComponent(version)}/catalogue`;

export const projectDocumentsEndpoint = (id: string): string => `${projectEndpoint(id)}/documents`;

export const projectDocumentEndpoint = (id: string, documentId: string): string =>
  `${projectDocumentsEndpoint(id)}/${encodeURIComponent(documentId)}`;

export { projectDocumentSchema };
export type ProjectDocumentWire = z.infer<typeof projectDocumentSchema>;
export const projectDocumentListSchema = z.array(projectDocumentSchema);

/**
 * The file types a background document may be (t-74): intake's, listed here
 * rather than imported, since intake carries the file parsers. A test holds
 * the two lists together.
 */
export const DOCUMENT_EXTENSIONS: readonly string[] = [
  '.pdf',
  '.docx',
  '.pptx',
  '.html',
  '.htm',
  '.md',
  '.txt',
];

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
    /**
     * How far a project may adjust the weights (t-72), or null for a version
     * that allows none: the weights section is offered only when it is set.
     */
    adjustment: z
      .object({
        weights: z.object({
          ethos: z.number(),
          pathos: z.number(),
          logos: z.number(),
          kairos: z.number(),
        }),
        priorityDimensions: z.object({ add: z.number().int(), remove: z.number().int() }),
      })
      .nullable(),
  }),
  result: z.object({
    profiles: z.array(idName),
    /** The appeals, by name, for the weights section. */
    appeals: z.array(idName),
    /** A core dimension has no `group`; only those can be made a priority (t-72). */
    dimensions: z.array(idName.extend({ appeal: z.string(), group: z.string().nullable() })),
  }),
});

export type DefaultsCatalogue = z.infer<typeof defaultsCatalogueSchema>;
