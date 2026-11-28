/**
 * Files uploaded for a batch (t-102, `.context/app/batches.md`).
 *
 * A batch cannot carry its files in one request: Vercel refuses any body over
 * 4.5 MB before the route runs, and reading a hundred files would hold the
 * request far too long. So each file is uploaded on its own first
 * (`POST /api/v1/contents`), under the same limits and refusals as a single
 * review's upload (`readUpload`, `extractText`, `assessableText`), and its
 * text is read in that request. It is stored as a `Content` row with no
 * review, `awaitingBatch` set, and a batch item names it as `{ contentId }`.
 * No raw file is kept, so no storage provider is involved.
 *
 * **Claimed once.** An item takes an upload by clearing `awaitingBatch` in a
 * conditional update, in the transaction that writes its review
 * (`enqueueAssessments`). Postgres re-checks a waiting update's condition
 * on the row as the first one left it, so of two batches naming one upload
 * only one finds it still set; the other is refused, and nothing of it is
 * stored.
 *
 * **Unclaimed for a day, deleted.** An upload that never joins a batch would
 * otherwise be kept forever by a workspace with no retention window. The
 * hourly job ({@link purgeUnclaimedUploads}) deletes those still waiting
 * {@link UPLOAD_CLAIM_WINDOW_MS} after they were made. A claim racing it is
 * safe the same way: whichever writes the row first wins, and the other's
 * condition no longer holds.
 *
 * Runs in the caller's tenant context (the route's guard, or the job's
 * per-workspace pass).
 */
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import { sha256 } from '@/lib/app/frameworks/store';
import { countWords, extractText } from '@/lib/app/intake/extract-text';
import type { UploadedFile } from '@/lib/app/intake/upload';
import { assessableText } from '@/lib/app/assessments/text';
import { refusingAsApi } from '@/lib/app/assessments/api/service';

/** How long an upload waits for a batch to take it before it is deleted: 24 hours. */
export const UPLOAD_CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;

/** An upload, as `POST /api/v1/contents` answers it. */
export interface UploadView {
  /** What a batch item names it by: `{ contentId }`. */
  id: string;
  fileName: string;
  /** From the file's own metadata or first heading, else its name; a batch item's label replaces it. */
  title: string | null;
  wordCount: number;
  createdAt: string;
  /** When it is deleted if no batch has taken it by then. */
  expiresAt: string;
}

/**
 * Read a file's text and store it for a batch to take.
 *
 * @throws IntakeError — the file (415 `INVALID_FILE_TYPE`, 413 `FILE_TOO_LARGE`, 422 `TOO_MANY_PAGES`, …)
 * @throws APIError — 400 `CONTENT_EMPTY` / 422 `TEXT_TOO_LONG`, as a review's upload is refused
 */
export async function storeUpload(file: UploadedFile, userId: string): Promise<UploadView> {
  const extracted = await extractText(file.bytes, file.name);
  // The check a review's upload meets when it is stored (`enqueue.ts`), here
  // at upload: a batch naming it later has nothing left to refuse it for.
  const text = await refusingAsApi(() => assessableText(extracted.text));
  const row = await prisma.content.create({
    data: {
      orgId: requireOrgId(),
      title: extracted.title,
      sourceKind: 'FILE',
      fileName: file.name,
      text,
      textSha256: await sha256(text),
      wordCount: countWords(text),
      createdByUserId: userId,
      awaitingBatch: true,
    },
    select: { id: true, fileName: true, title: true, wordCount: true, createdAt: true },
  });
  return {
    id: row.id,
    fileName: row.fileName ?? file.name,
    title: row.title,
    wordCount: row.wordCount ?? 0,
    createdAt: row.createdAt.toISOString(),
    expiresAt: new Date(row.createdAt.getTime() + UPLOAD_CLAIM_WINDOW_MS).toISOString(),
  };
}

/**
 * Delete this workspace's uploads no batch took within
 * {@link UPLOAD_CLAIM_WINDOW_MS}. A claimed one has `awaitingBatch` cleared,
 * so it is never matched; the `assessments` condition is the same promise
 * said twice, so a review is never taken with an upload by the cascade.
 * Idempotent.
 */
export async function purgeUnclaimedUploads(now: Date = new Date()): Promise<{ uploads: number }> {
  const { count } = await prisma.content.deleteMany({
    where: {
      orgId: requireOrgId(),
      awaitingBatch: true,
      createdAt: { lt: new Date(now.getTime() - UPLOAD_CLAIM_WINDOW_MS) },
      assessments: { none: {} },
    },
  });
  return { uploads: count };
}
