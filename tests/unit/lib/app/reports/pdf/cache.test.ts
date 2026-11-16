/**
 * Tests: where a report's PDF is kept (t-31) — the keys, when there is a
 * cache at all, and what a failed read, write or delete means.
 *
 * @see lib/app/reports/pdf/cache.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageProvider } from '@/lib/storage/providers/types';

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
const client = vi.hoisted(() => ({ provider: null as StorageProvider | null }));
vi.mock('@/lib/storage/client', () => ({
  getStorageClient: vi.fn(() => client.provider),
}));

import {
  deleteReportPdfs,
  readCachedPdf,
  reportPdfFolder,
  reportPdfKey,
  reportPdfStore,
  ReportPdfCleanupError,
  sweepReportPdfs,
  writeCachedPdf,
} from '@/lib/app/reports/pdf/cache';

function provider(over: Partial<StorageProvider> = {}): StorageProvider {
  return {
    name: 'fake',
    capabilities: { privateObjects: true, download: true, signedUrls: false },
    upload: vi.fn(async (_f: Buffer, { key }: { key: string }) => ({ key, url: key, size: 1 })),
    delete: vi.fn(async (key: string) => ({ success: true, key })),
    deletePrefix: vi.fn(async (key: string) => ({ success: true, key })),
    download: vi.fn(async (key: string) => ({ key, body: Buffer.from('pdf'), size: 3 })),
    ...over,
  };
}

beforeEach(() => {
  client.provider = null;
});

describe('keys', () => {
  it("files each run under its assessment's folder in the org", () => {
    const at = new Date('2026-11-15T10:00:00.000Z');
    expect(reportPdfFolder('org-a', 'asm_1')).toBe('orgs/org-a/reports/asm_1/');
    expect(reportPdfKey('org-a', 'asm_1', at)).toBe(`orgs/org-a/reports/asm_1/${at.getTime()}.pdf`);
  });

  it('refuses an org id that could escape its prefix', () => {
    expect(() => reportPdfFolder('../org-b', 'asm_1')).toThrow();
  });
});

describe('reportPdfStore', () => {
  it('is the org’s storage when it keeps private objects and reads them back', () => {
    client.provider = provider();
    expect(reportPdfStore('org-a')).toBe(client.provider);
  });

  it('is none without storage, or with storage that cannot keep or read a private file', () => {
    expect(reportPdfStore('org-a')).toBeNull();
    client.provider = provider({
      capabilities: { privateObjects: false, download: false, signedUrls: false },
    });
    expect(reportPdfStore('org-a')).toBeNull();
    client.provider = provider({ download: undefined });
    expect(reportPdfStore('org-a')).toBeNull();
  });
});

describe('reading and writing', () => {
  it('reads a cached file, and treats a failed read as no file', async () => {
    const store = provider();
    expect((await readCachedPdf(store, 'k'))?.toString()).toBe('pdf');
    const missing = provider({
      download: vi.fn(async () => Promise.reject(new Error('not found'))),
    });
    expect(await readCachedPdf(missing, 'k')).toBeNull();
  });

  it('writes a private PDF, and reports a failed write without throwing', async () => {
    const store = provider();
    expect(await writeCachedPdf(store, 'k', Buffer.from('x'))).toBe(true);
    expect(store.upload).toHaveBeenCalledWith(Buffer.from('x'), {
      key: 'k',
      contentType: 'application/pdf',
      public: false,
    });
    const full = provider({ upload: vi.fn(async () => Promise.reject(new Error('disk full'))) });
    expect(await writeCachedPdf(full, 'k', Buffer.from('x'))).toBe(false);
  });
});

describe('deleting', () => {
  it("deletes the assessment's folder, and does nothing without storage", async () => {
    await expect(deleteReportPdfs('org-a', 'asm_1')).resolves.toBeUndefined();
    client.provider = provider();
    await deleteReportPdfs('org-a', 'asm_1');
    expect(client.provider.deletePrefix).toHaveBeenCalledWith('orgs/org-a/reports/asm_1/');
  });

  it('calls no storage where no PDF can have been cached', async () => {
    // A provider that cannot keep a private file (Vercel Blob): nothing was written.
    client.provider = provider({
      capabilities: { privateObjects: false, download: false, signedUrls: false },
      deletePrefix: vi.fn(async () => Promise.reject(new Error('should not be called'))),
    });
    await expect(deleteReportPdfs('org-a', 'asm_1')).resolves.toBeUndefined();
  });

  it('calls no storage for an id no assessment could have', async () => {
    client.provider = provider();
    for (const id of ['..', '.', 'a/b', '']) await deleteReportPdfs('org-a', id);
    expect(client.provider.deletePrefix).not.toHaveBeenCalled();
  });

  it('throws when storage reports the delete failed, so the caller keeps the row', async () => {
    client.provider = provider({
      deletePrefix: vi.fn(async (key: string) => ({ success: false, key })),
    });
    await expect(deleteReportPdfs('org-a', 'asm_1')).rejects.toBeInstanceOf(ReportPdfCleanupError);
  });

  it('the sweep after the row deletes each one and never throws', async () => {
    client.provider = provider({
      deletePrefix: vi
        .fn()
        .mockResolvedValueOnce({ success: false, key: 'a' })
        .mockResolvedValueOnce({ success: true, key: 'b' }),
    });
    await expect(sweepReportPdfs('org-a', ['asm_1', 'asm_2'])).resolves.toBeUndefined();
    expect(client.provider.deletePrefix).toHaveBeenCalledTimes(2);
  });
});
