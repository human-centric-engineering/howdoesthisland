// @vitest-environment happy-dom

/**
 * Reading a chosen file as base64 for the API (t-74, t-78).
 *
 * @see lib/app/intake/read-as-base64.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAsBase64 } from '@/lib/app/intake/read-as-base64';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A FileReader that answers `readAsDataURL` with the given outcome. */
function readerAnswering(outcome: { result?: unknown; error?: DOMException | null }) {
  return class {
    result: unknown = null;
    error: DOMException | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL() {
      queueMicrotask(() => {
        if ('error' in outcome) {
          this.error = outcome.error ?? null;
          this.onerror?.();
        } else {
          this.result = outcome.result;
          this.onload?.();
        }
      });
    }
  };
}

describe('readAsBase64', () => {
  it('gives the file’s bytes as base64, without the data: prefix', async () => {
    const file = new File(['Hello, world'], 'note.txt', { type: 'text/plain' });
    await expect(readAsBase64(file)).resolves.toBe(btoa('Hello, world'));
  });

  it('rejects with the reader’s error', async () => {
    const error = new DOMException('Permission denied', 'NotReadableError');
    vi.stubGlobal('FileReader', readerAnswering({ error }));
    await expect(readAsBase64(new File(['x'], 'x.txt'))).rejects.toBe(error);
  });

  it('rejects with its own error when the reader gives none', async () => {
    vi.stubGlobal('FileReader', readerAnswering({ error: null }));
    await expect(readAsBase64(new File(['x'], 'x.txt'))).rejects.toThrow(
      'The file could not be read.'
    );
  });

  it('gives an empty string for a result that is not text', async () => {
    vi.stubGlobal('FileReader', readerAnswering({ result: new ArrayBuffer(2) }));
    await expect(readAsBase64(new File(['x'], 'x.txt'))).resolves.toBe('');
  });
});
