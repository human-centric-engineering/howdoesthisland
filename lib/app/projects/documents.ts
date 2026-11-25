/**
 * A project's context documents (t-74, D18, app-plan §8.4): list, add, remove.
 *
 * A document's text goes into the workspace's knowledge base through core's
 * `uploadDocument`, which chunks and embeds it, and a `ProjectDocument` row
 * links it to the project. Everything runs in the caller's tenant context
 * (the route's guard), and every read names that org.
 *
 * **Adding is synchronous**, as core's own upload is: the request returns
 * once the document is embedded, with the link, or with why it could not be
 * read or indexed. A document's status is the knowledge row's, read live, so
 * one core re-processes later reads as such.
 *
 * **Whether this upload created the knowledge row.** `uploadDocument`
 * deduplicates by content hash: it returns an existing ready row, or the row
 * a concurrent upload of the same text won the slug race with, as readily as
 * one it made. It does not say which, so it is worked out here:
 *
 * - the ids of every row with this text's hash are read *before* the call; a
 *   row among them was reused, whatever else is true of it;
 * - a row that is new since then was made by this call, or by an upload
 *   racing it (core's knowledge page, or another project's add); it is
 *   counted as this upload's only when it names this user as its uploader and
 *   this file name.
 *
 * A lookup alone cannot tell this call from a racing one, and the uploader
 * and file name alone cannot tell this call from an earlier upload of the
 * same file by the same person; together they leave only the same person
 * uploading the same file through core's page and this app at once, which
 * the comparison counts as this app's.
 *
 * **Removing a link** deletes the knowledge row only when an upload by this
 * app created it, no other link to it remains, no agent is granted it
 * directly, and it carries no tag (an admin's mark, and how agents are
 * granted documents in bulk), and it is not still being embedded (another
 * add may hold it). Otherwise only the link goes. A reused row is
 * never deleted on the app's account: it may be another project's, or one an
 * admin put in the knowledge base. "Created by this app" is kept on the links
 * while any remains: a removed link that holds it hands it to another, so the
 * last link out still knows. The read and the writes are one serializable
 * transaction, so two removals racing for the last link cannot each see the
 * other's link and both leave the row behind.
 */
import { APIError, NotFoundError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { isSerializableConflict } from '@/lib/db/serializable-conflict';
import { isUniqueViolationOn, type UniqueConstraint } from '@/lib/db/unique-violation';
import { logger } from '@/lib/logging';
import { requireOrgId } from '@/lib/tenancy/context';
import { uploadDocument } from '@/lib/orchestration/knowledge/document-manager';
import { invalidateAllAgentAccess } from '@/lib/orchestration/knowledge/resolveAgentDocumentAccess';
import { extractText, type IntakeLimits } from '@/lib/app/intake/extract-text';
import { fetchPage } from '@/lib/app/intake/fetch-page';
import { IntakeError, IntakeErrorCodes } from '@/lib/app/intake/errors';
import { sha256 } from '@/lib/app/frameworks/store';
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_TITLE,
  type AddDocumentRequest,
} from '@/lib/app/projects/validations';
import type { DocumentStatus, ProjectDocumentView } from '@/lib/app/projects/wire';
import { isForeignKeyFailure } from '@/lib/app/assessments/prisma-errors';

/**
 * What a context document may be. Larger than a review's text (40,000
 * characters): a brand guide or positioning paper runs longer than a page of
 * copy, and only passages of it reach the AI reviewers (t-75). 200,000
 * characters is about 120 pages of prose.
 */
export const DOCUMENT_LIMITS: Partial<IntakeLimits> = {
  maxBytes: MAX_DOCUMENT_BYTES,
  maxChars: 200_000,
  maxPages: 300,
};

/** The most documents one project holds. */
export const MAX_PROJECT_DOCUMENTS = 50;

/** The link's unique key: a knowledge row is linked to a project once. */
export const PROJECT_DOCUMENT_UNIQUE = {
  index: 'app_project_document_projectId_knowledgeDocumentId_key',
  model: 'ProjectDocument',
  fields: ['projectId', 'knowledgeDocumentId'],
} as const satisfies UniqueConstraint;

/** Tries at a removal that clashed with a concurrent one. */
const REMOVE_ATTEMPTS = 3;

const KNOWN_STATUSES: readonly DocumentStatus[] = [
  'processing',
  'ready',
  'failed',
  'pending_review',
  'cleaning',
];

/** Core's status string, as the API answers it; one core adds later reads as `processing`. */
function statusOf(status: string | undefined): DocumentStatus {
  return KNOWN_STATUSES.find((known) => known === status) ?? 'processing';
}

interface LinkRow {
  id: string;
  knowledgeDocumentId: string;
  title: string;
  fileName: string | null;
  sourceUrl: string | null;
  createdAt: Date;
}

const linkSelect = {
  id: true,
  knowledgeDocumentId: true,
  title: true,
  fileName: true,
  sourceUrl: true,
  createdAt: true,
} as const;

interface KnowledgeState {
  status: string;
  chunkCount: number;
}

function documentView(link: LinkRow, knowledge: KnowledgeState | undefined): ProjectDocumentView {
  return {
    id: link.id,
    title: link.title,
    fileName: link.fileName,
    sourceUrl: link.sourceUrl,
    status: statusOf(knowledge?.status),
    chunkCount: knowledge?.chunkCount ?? 0,
    addedAt: link.createdAt,
  };
}

/** The knowledge rows behind `links`, in one read. */
async function knowledgeStates(ids: string[], orgId: string): Promise<Map<string, KnowledgeState>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.aiKnowledgeDocument.findMany({
    where: { id: { in: ids }, orgId },
    select: { id: true, status: true, chunkCount: true },
  });
  return new Map(rows.map((row) => [row.id, { status: row.status, chunkCount: row.chunkCount }]));
}

/** 404 unless the project is in this workspace; says whether it is archived. */
async function requireProject(projectId: string, orgId: string): Promise<{ archived: boolean }> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, archivedAt: true },
  });
  if (!project) throw new NotFoundError('Project not found');
  return { archived: project.archivedAt != null };
}

/** The project's documents, oldest first, each with its knowledge row's status. */
export async function listProjectDocuments(projectId: string): Promise<ProjectDocumentView[]> {
  const orgId = requireOrgId();
  await requireProject(projectId, orgId);
  const links = await prisma.projectDocument.findMany({
    where: { projectId, orgId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: linkSelect,
  });
  const states = await knowledgeStates(
    links.map((link) => link.knowledgeDocumentId),
    orgId
  );
  return links.map((link) => documentView(link, states.get(link.knowledgeDocumentId)));
}

/** The text to index, and what the link records of where it came from. */
interface Intake {
  text: string;
  title: string;
  /** The name `uploadDocument` is given; for a page, one made from its address. */
  uploadName: string;
  fileName: string | null;
  sourceUrl: string | null;
}

/** A page's upload name: its host and path, as a file name core's knowledge page can show. */
function pageFileName(url: string): string {
  const { hostname, pathname } = new URL(url);
  const path = pathname.replace(/\/+$/, '').replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${hostname}${path}`.slice(0, 200) + '.html';
}

/**
 * Intake's refusals as a context document's: two of its messages speak of
 * assessing the text, which is not what happens to this one.
 */
function asDocumentRefusal(err: unknown): unknown {
  if (!(err instanceof IntakeError)) return err;
  if (err.intakeCode === IntakeErrorCodes.TEXT_TOO_LONG) {
    const max = (DOCUMENT_LIMITS.maxChars ?? 0).toLocaleString('en-GB');
    return new IntakeError(
      IntakeErrorCodes.TEXT_TOO_LONG,
      `This document has more text than a background document may hold (${max} characters). Split it, or add the part that matters.`,
      err.details
    );
  }
  if (err.intakeCode === IntakeErrorCodes.NO_TEXT) {
    return new IntakeError(
      IntakeErrorCodes.NO_TEXT,
      'This document has no text to read.',
      err.details
    );
  }
  return err;
}

async function intake(source: AddDocumentRequest['source']): Promise<Intake> {
  try {
    return await readSource(source);
  } catch (err) {
    throw asDocumentRefusal(err);
  }
}

async function readSource(source: AddDocumentRequest['source']): Promise<Intake> {
  if ('url' in source) {
    const page = await fetchPage(source.url, { limits: DOCUMENT_LIMITS });
    return {
      text: page.text,
      title: page.title,
      uploadName: pageFileName(page.url),
      fileName: null,
      sourceUrl: page.url,
    };
  }
  const file = await extractText(source.file.bytes, source.file.name, DOCUMENT_LIMITS);
  return {
    text: file.text,
    title: file.title,
    uploadName: source.file.name,
    fileName: source.file.name,
    sourceUrl: null,
  };
}

function notIndexed(): APIError {
  return new APIError(
    'The document was read but could not be indexed. Try again in a moment.',
    'DOCUMENT_NOT_INDEXED',
    502
  );
}

/**
 * Put the text in the knowledge base, and say whether this call made the row
 * (see the module header). A row this call made that failed to index is
 * deleted: nobody here can see or retry it, and a retry makes a new one,
 * since `uploadDocument` reuses only ready rows.
 */
async function upload(
  doc: Intake,
  fileHash: string,
  userId: string,
  orgId: string
): Promise<{ knowledgeDocumentId: string; created: boolean }> {
  const before = new Set(
    (
      await prisma.aiKnowledgeDocument.findMany({
        where: { fileHash, orgId },
        select: { id: true },
      })
    ).map((row) => row.id)
  );
  const madeByThisCall = (row: { id: string; uploadedBy: string | null; fileName: string }) =>
    !before.has(row.id) && row.uploadedBy === userId && row.fileName === doc.uploadName;

  let knowledge;
  try {
    knowledge = await uploadDocument(
      doc.text,
      doc.uploadName,
      userId,
      doc.sourceUrl ?? undefined,
      doc.title
    );
  } catch (err) {
    logger.error('Project document could not be indexed', {
      error: err instanceof Error ? err.message : String(err),
    });
    const failed = await prisma.aiKnowledgeDocument.findMany({
      where: { fileHash, orgId, status: 'failed' },
      select: { id: true, uploadedBy: true, fileName: true },
    });
    // A row a racing add was handed and has linked is that add's to settle:
    // deleting it would cascade its link away unseen.
    const candidates = failed.filter(madeByThisCall).map((row) => row.id);
    const linked = new Set(
      candidates.length === 0
        ? []
        : (
            await prisma.projectDocument.findMany({
              where: { knowledgeDocumentId: { in: candidates } },
              select: { knowledgeDocumentId: true },
            })
          ).map((row) => row.knowledgeDocumentId)
    );
    const ours = candidates.filter((id) => !linked.has(id));
    if (ours.length > 0) {
      await prisma.aiKnowledgeDocument.deleteMany({ where: { id: { in: ours } } });
    }
    throw notIndexed();
  }
  // Core's dedupe reads by hash alone, so where row isolation is off
  // (`TENANCY_MODE=single`, with more than the install org) it can hand back
  // another workspace's row. That row is never linked: the project would read
  // its status and, at t-75, its passages. The refusal does not say why, as
  // that would tell this workspace another holds the same text.
  if (knowledge.orgId !== orgId) {
    logger.warn("Project document upload returned another workspace's knowledge row", {
      knowledgeDocumentId: knowledge.id,
    });
    throw notIndexed();
  }
  // A row a racing upload won with is returned as it stands, which may still
  // be processing; the link is made anyway, and its status is read live.
  return { knowledgeDocumentId: knowledge.id, created: madeByThisCall(knowledge) };
}

/**
 * A link the project already holds, renamed when the caller gave a title: a
 * re-add with a title is how a document is renamed, rather than one dropped.
 */
async function retitled(link: LinkRow, title: string | undefined, orgId: string): Promise<LinkRow> {
  if (title === undefined || title === link.title) return link;
  await prisma.projectDocument.updateMany({ where: { id: link.id, orgId }, data: { title } });
  return { ...link, title };
}

/**
 * Add a document to the project: read it (a file in the intake formats, or a
 * page by URL), index it in the workspace's knowledge base, and link it.
 *
 * @returns the link, and whether it is new: a document the project already
 *   holds (the same text) answers with its existing link, renamed to `title`
 *   when one is given.
 */
export async function addProjectDocument(
  projectId: string,
  body: AddDocumentRequest,
  userId: string
): Promise<{ document: ProjectDocumentView; added: boolean }> {
  const orgId = requireOrgId();
  const { archived } = await requireProject(projectId, orgId);
  // As a review is refused (PROJECT_ARCHIVED): nothing reads an archived
  // project's documents, so none is fetched or embedded for it. Removing one
  // stays allowed.
  if (archived) {
    throw new APIError(
      'This project is archived. Restore it to add documents.',
      'PROJECT_ARCHIVED',
      409
    );
  }

  const doc = await intake(body.source);
  // A file's or page's own title is not bounded as a given one is.
  const title = body.title ?? doc.title.slice(0, MAX_DOCUMENT_TITLE);
  const fileHash = await sha256(doc.text);

  // The same text already in this project answers with its link, before the
  // cap (re-adding one the project holds adds nothing) and without indexing
  // it again. A failed row is not reused: the upload below makes a new one.
  const sameText = await prisma.aiKnowledgeDocument.findMany({
    where: { fileHash, orgId, status: { not: 'failed' } },
    select: { id: true },
  });
  const held = sameText.length
    ? await prisma.projectDocument.findFirst({
        where: { projectId, orgId, knowledgeDocumentId: { in: sameText.map((row) => row.id) } },
        orderBy: { createdAt: 'asc' },
        select: linkSelect,
      })
    : null;
  if (held) {
    const link = await retitled(held, body.title, orgId);
    const states = await knowledgeStates([link.knowledgeDocumentId], orgId);
    return { document: documentView(link, states.get(link.knowledgeDocumentId)), added: false };
  }

  // Read before the slow indexing, so two adds at once at 49 can both pass:
  // the cap bounds a project's size, not an exact count, and one over it
  // under a race is harmless.
  const count = await prisma.projectDocument.count({ where: { projectId, orgId } });
  if (count >= MAX_PROJECT_DOCUMENTS) {
    throw new APIError(
      `A project holds at most ${MAX_PROJECT_DOCUMENTS} background documents. Remove one to add another.`,
      'TOO_MANY_DOCUMENTS',
      409,
      { limit: MAX_PROJECT_DOCUMENTS }
    );
  }

  const { knowledgeDocumentId, created } = await upload(doc, fileHash, userId, orgId);

  const existing = await prisma.projectDocument.findFirst({
    where: { projectId, orgId, knowledgeDocumentId },
    select: linkSelect,
  });
  let link: LinkRow;
  let added = true;
  if (existing) {
    link = await retitled(existing, body.title, orgId);
    added = false;
  } else {
    try {
      link = await prisma.projectDocument.create({
        data: {
          orgId,
          projectId,
          knowledgeDocumentId,
          title,
          fileName: doc.fileName,
          sourceUrl: doc.sourceUrl,
          createdByUpload: created,
          addedByUserId: userId,
        },
        select: linkSelect,
      });
    } catch (err) {
      // The knowledge row was deleted (core's knowledge page, or another
      // project's removal) between indexing it and linking it.
      if (isForeignKeyFailure(err)) {
        throw new APIError(
          'The document was removed from the knowledge base while it was being added. Try again.',
          'DOCUMENT_CHANGED',
          409
        );
      }
      // The same text added to this project at the same moment: the other
      // request linked it. If this one made the row, its link says so.
      if (!isUniqueViolationOn(err, PROJECT_DOCUMENT_UNIQUE)) throw err;
      const raced = await prisma.projectDocument.findFirst({
        where: { projectId, orgId, knowledgeDocumentId },
        select: linkSelect,
      });
      if (!raced) throw err;
      link = await retitled(raced, body.title, orgId);
      added = false;
    }
  }
  if (!added && created) {
    await prisma.projectDocument.updateMany({
      where: { id: link.id, orgId },
      data: { createdByUpload: true },
    });
  }
  const states = await knowledgeStates([knowledgeDocumentId], orgId);
  return { document: documentView(link, states.get(knowledgeDocumentId)), added };
}

/** What removing a link did. */
export interface RemovedDocument {
  id: string;
  /** True when the knowledge document went too; false when only the link did. */
  knowledgeDocumentDeleted: boolean;
}

async function removeOnce(
  projectId: string,
  documentId: string,
  orgId: string
): Promise<RemovedDocument> {
  return await prisma.$transaction(
    async (tx) => {
      const link = await tx.projectDocument.findFirst({
        where: { id: documentId, projectId, orgId },
        select: { id: true, knowledgeDocumentId: true, createdByUpload: true },
      });
      if (!link) throw new NotFoundError('Document not found');
      await tx.projectDocument.delete({ where: { id: link.id } });

      const knowledgeDocumentId = link.knowledgeDocumentId;
      const others = await tx.projectDocument.findMany({
        where: { knowledgeDocumentId },
        select: { id: true, createdByUpload: true },
        orderBy: { createdAt: 'asc' },
      });
      const createdByApp = link.createdByUpload || others.some((other) => other.createdByUpload);
      if (others.length > 0) {
        // Another link keeps the row; hand it the fact that the app made it.
        if (link.createdByUpload && !others.some((other) => other.createdByUpload)) {
          await tx.projectDocument.update({
            where: { id: others[0].id },
            data: { createdByUpload: true },
          });
        }
        return { id: link.id, knowledgeDocumentDeleted: false };
      }
      if (!createdByApp) return { id: link.id, knowledgeDocumentDeleted: false };

      // A row still being embedded may be another add's, handed it by core's
      // slug race; deleting it would fail that add. It stays, as any row does
      // that this rule keeps.
      const row = await tx.aiKnowledgeDocument.findMany({
        where: { id: knowledgeDocumentId, orgId },
        select: { status: true },
      });
      if (row[0]?.status === 'processing') {
        return { id: link.id, knowledgeDocumentDeleted: false };
      }

      // A tag is an admin's curation, whether or not an agent is granted it
      // yet: core's dedupe hands an admin who uploads the same text this row,
      // and a tag is the mark they leave on it.
      const [direct, tagged] = await Promise.all([
        tx.aiAgentKnowledgeDocument.count({ where: { documentId: knowledgeDocumentId } }),
        tx.aiKnowledgeDocumentTag.count({ where: { documentId: knowledgeDocumentId } }),
      ]);
      if (direct + tagged > 0) return { id: link.id, knowledgeDocumentDeleted: false };

      // Chunks cascade with it, as core's `deleteDocument` relies on.
      await tx.aiKnowledgeDocument.deleteMany({ where: { id: knowledgeDocumentId } });
      return { id: link.id, knowledgeDocumentDeleted: true };
    },
    { isolationLevel: 'Serializable' }
  );
}

/**
 * Remove a document from the project. The knowledge document goes too only
 * when the app's upload made it, nothing else links it, no agent is granted
 * it, and it carries no tag (see the module header).
 */
export async function removeProjectDocument(
  projectId: string,
  documentId: string
): Promise<RemovedDocument> {
  const orgId = requireOrgId();
  await requireProject(projectId, orgId);
  for (let attempt = 1; ; attempt++) {
    try {
      const removed = await removeOnce(projectId, documentId, orgId);
      // Agents' resolved document sets are cached; core's delete route clears them too.
      if (removed.knowledgeDocumentDeleted) invalidateAllAgentAccess();
      return removed;
    } catch (err) {
      if (attempt >= REMOVE_ATTEMPTS || !isSerializableConflict(err)) throw err;
    }
  }
}
