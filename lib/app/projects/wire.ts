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
  /**
   * Its adjustment to the framework's weights (t-72), as the version checked
   * it, or null for none. Its shape is the framework's: HowDoesThisLand's is
   * `{ weights?, priorityDimensions? }`.
   */
  overlay: z.record(z.string(), z.unknown()).nullable(),
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
  overlay: Record<string, unknown> | null;
  archived: boolean;
  archivedAt: Date | null;
  reviewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A context document's status (t-74): its knowledge row's, read live.
 * `processing` while it is chunked and embedded; `ready` once searchable;
 * `failed` when indexing failed; `pending_review` and `cleaning` when an
 * admin is working on it in core's knowledge base.
 */
export const documentStatusSchema = z.enum([
  'processing',
  'ready',
  'failed',
  'pending_review',
  'cleaning',
]);

export type DocumentStatus = z.infer<typeof documentStatusSchema>;

/** One of a project's context documents. Times are ISO strings on the wire. */
export const projectDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** The file it was read from, or null for a page. */
  fileName: z.string().nullable(),
  /** The page it was fetched from, after redirects, or null for a file. */
  sourceUrl: z.string().nullable(),
  status: documentStatusSchema,
  /** How many passages it was split into for search. */
  chunkCount: z.number().int(),
  addedAt: z.iso.datetime(),
});

/** What the service returns: as {@link projectDocumentSchema}, with a `Date`. */
export interface ProjectDocumentView {
  id: string;
  title: string;
  fileName: string | null;
  sourceUrl: string | null;
  status: DocumentStatus;
  chunkCount: number;
  addedAt: Date;
}

/** DELETE …/documents/{documentId}. */
export const removedDocumentSchema = z.object({
  id: z.string(),
  /** True when the document left the workspace's knowledge base too; false when only the link went. */
  knowledgeDocumentDeleted: z.boolean(),
});
