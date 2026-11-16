/**
 * Where a report's PDF is kept once rendered (t-31), and how it goes.
 *
 * A final assessment does not change, so its PDF is rendered once and kept
 * under the workspace's private storage:
 * `orgs/{orgId}/reports/{assessmentId}/{completedAt ms}.pdf`. The completion
 * time is in the name so a file can never be served for a different run of
 * the same id. Each assessment's files sit under a folder of their own, so
 * deleting that folder removes every file the assessment ever had.
 *
 * **The file must not outlive its assessment.** A deleted or purged
 * assessment's content is gone, so its PDF must be too, or the retention
 * window would not hold for the report. So deleting an assessment
 * (`remove` in `lib/app/assessments/api/service.ts`) and the retention purge
 * (`lib/app/retention/purge.ts`) both call {@link deleteReportPdfs} first,
 * and keep the row if it fails, so a later attempt can finish the job. Org
 * erasure deletes the whole `orgs/{orgId}/` tree, these files included.
 *
 * **No cache without private storage that can read back.** With no storage
 * configured, or a provider that cannot keep a private object or download it
 * (Vercel Blob), every request renders, and nothing is written.
 */
import { getStorageClient } from '@/lib/storage/client';
import { orgKeyPrefix } from '@/lib/storage/org-keys';
import { getStorageCapabilities, type StorageProvider } from '@/lib/storage/providers/types';
import { logger } from '@/lib/logging';

/** What an assessment id is (a cuid), and so what may name a folder here. */
const ASSESSMENT_ID = /^[A-Za-z0-9_-]+$/;

/** The folder holding every PDF an assessment has. */
export function reportPdfFolder(orgId: string, assessmentId: string): string {
  return `${orgKeyPrefix(orgId)}reports/${assessmentId}/`;
}

/** The key of one run's PDF. */
export function reportPdfKey(orgId: string, assessmentId: string, completedAt: Date): string {
  return `${reportPdfFolder(orgId, assessmentId)}${completedAt.getTime()}.pdf`;
}

/** The org's storage, when it can keep a private PDF and read it back; else `null`. */
export function reportPdfStore(orgId: string): StorageProvider | null {
  const storage = getStorageClient({ orgId });
  if (!storage) return null;
  const caps = getStorageCapabilities(storage);
  return caps.privateObjects && caps.download && storage.download ? storage : null;
}

/** The cached PDF at `key`, or `null` when there is none (or it cannot be read). */
export async function readCachedPdf(store: StorageProvider, key: string): Promise<Buffer | null> {
  try {
    const object = await store.download?.(key);
    return object?.body ?? null;
  } catch (err) {
    // Providers report a missing object as a thrown error, the same as a
    // failed read. Either way the answer is to render again, which rewrites
    // the file.
    logger.debug('Report PDF: no cached file', { key, err });
    return null;
  }
}

/** Keep a rendered PDF. A failure is logged, not thrown: the caller still has the bytes. */
export async function writeCachedPdf(
  store: StorageProvider,
  key: string,
  pdf: Buffer
): Promise<boolean> {
  try {
    await store.upload(pdf, { key, contentType: 'application/pdf', public: false });
    return true;
  } catch (err) {
    logger.warn('Report PDF: the rendered file could not be cached', { key, err });
    return false;
  }
}

export class ReportPdfCleanupError extends Error {
  constructor(readonly folder: string) {
    super(`The cached report PDFs under ${folder} could not be deleted`);
    this.name = 'ReportPdfCleanupError';
  }
}

/**
 * After the row is gone: delete the assessment's PDFs once more, logging a
 * failure rather than throwing.
 *
 * The first delete, before the row, is what a failure keeps the row for.
 * This second one closes a race with a render. A render checks the row is
 * still there after writing its file (`getReportPdf`), so a file written
 * after this point is removed by the render itself, and one written before
 * it is removed here. Without it, a render that wrote between the first
 * delete and the row's delete would leave a file behind.
 */
export async function sweepReportPdfs(orgId: string, assessmentIds: string[]): Promise<void> {
  for (const id of assessmentIds) {
    try {
      await deleteReportPdfs(orgId, id);
    } catch (err) {
      logger.error('Report PDF: a deleted review left a file behind', err, { assessmentId: id });
    }
  }
}

/**
 * Delete every cached PDF of an assessment. Nothing to do without a store
 * that caches PDFs ({@link reportPdfStore}), or for an id no assessment has.
 * Throws {@link ReportPdfCleanupError} when the provider reports a failure,
 * so the caller can keep the row and try again.
 */
export async function deleteReportPdfs(orgId: string, assessmentId: string): Promise<void> {
  // Nothing can have been cached: no store that keeps PDFs, or an id that is
  // not one an assessment could have (a key is only ever built from a real
  // one). Either way, no storage call, so deleting a review does not depend on
  // storage that was never used for it.
  const storage = reportPdfStore(orgId);
  if (!storage || !ASSESSMENT_ID.test(assessmentId)) return;
  const folder = reportPdfFolder(orgId, assessmentId);
  const result = await storage.deletePrefix(folder);
  if (!result.success) throw new ReportPdfCleanupError(folder);
}
