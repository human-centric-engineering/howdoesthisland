/**
 * Tests: reading a file sent as `multipart/form-data` (t-80).
 *
 * Real requests, built with the platform's own `FormData` and parsed by
 * `request.formData()`, so what is proved is what a route reads.
 *
 * @see lib/app/intake/upload.ts
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { APIError } from '@/lib/api/errors';
import {
  isMultipart,
  MAX_OPTIONS_CHARS,
  MAX_UPLOAD_BODY_BYTES,
  readUpload,
} from '@/lib/app/intake/upload';
import { DEFAULT_INTAKE_LIMITS } from '@/lib/app/intake/extract-text';

const URL_ = 'http://localhost/api/v1/things';
const options = z.strictObject({ title: z.string().min(1).optional() });

function formRequest(build: (form: FormData) => void, headers: Record<string, string> = {}) {
  const form = new FormData();
  build(form);
  return new Request(URL_, { method: 'POST', body: form, headers });
}

async function refusal(promise: Promise<unknown>): Promise<{ status: number; code?: string }> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof APIError) return { status: err.status, code: err.code };
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('the proxy body limit', () => {
  it('is the largest upload body a route reads, so a body under it arrives whole', async () => {
    const config = (await import('@/next.config.js')) as {
      default?: { experimental?: { proxyClientMaxBodySize?: unknown } };
      experimental?: { proxyClientMaxBodySize?: unknown };
    };
    const resolved = config.default ?? config;
    expect(resolved.experimental?.proxyClientMaxBodySize).toBe(MAX_UPLOAD_BODY_BYTES);
  });

  it('carries the largest file intake reads with room for the framing and options', async () => {
    const request = formRequest((form) => {
      form.append(
        'file',
        new File([Buffer.alloc(DEFAULT_INTAKE_LIMITS.maxBytes)], 'a'.repeat(255))
      );
      form.append('options', 'x'.repeat(MAX_OPTIONS_CHARS));
    });
    const sent = await request.arrayBuffer();
    expect(sent.byteLength).toBeLessThanOrEqual(MAX_UPLOAD_BODY_BYTES);
  });
});

describe('isMultipart', () => {
  it('reads the content type, whatever its case and boundary', () => {
    expect(isMultipart(formRequest((f) => f.append('file', new File(['x'], 'a.txt'))))).toBe(true);
    const upper = new Request(URL_, {
      method: 'POST',
      headers: { 'content-type': 'Multipart/Form-Data; boundary=x' },
    });
    expect(isMultipart(upper)).toBe(true);
    const json = new Request(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(isMultipart(json)).toBe(false);
    expect(isMultipart(new Request(URL_, { method: 'POST' }))).toBe(false);
  });
});

describe('readUpload', () => {
  it('gives the file’s name and exact bytes, and the parsed options', async () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255]);
    const { file, options: parsed } = await readUpload(
      formRequest((form) => {
        form.append('file', new File([bytes], '  deck.pptx '));
        form.append('options', JSON.stringify({ title: 'Launch' }));
      }),
      options
    );
    expect(file.name).toBe('deck.pptx');
    expect(file.bytes.equals(bytes)).toBe(true);
    expect(parsed).toEqual({ title: 'Launch' });
  });

  it('reads no options part as {}', async () => {
    const { options: parsed } = await readUpload(
      formRequest((form) => form.append('file', new File(['x'], 'a.txt'))),
      options
    );
    expect(parsed).toEqual({});
  });

  it('413 for a Content-Length over the limit, before the body is parsed', async () => {
    const request = formRequest((form) => form.append('file', new File(['x'], 'a.txt')), {
      'content-length': String(MAX_UPLOAD_BODY_BYTES + 1),
    });
    let parsed = false;
    const original = request.formData.bind(request);
    request.formData = async () => {
      parsed = true;
      return original();
    };
    expect(await refusal(readUpload(request, options))).toEqual({
      status: 413,
      code: 'FILE_TOO_LARGE',
    });
    expect(parsed).toBe(false);
  });

  it('413 for a file over the route’s own limit', async () => {
    const request = formRequest((form) => form.append('file', new File(['123456'], 'a.txt')));
    expect(await refusal(readUpload(request, options, 5))).toEqual({
      status: 413,
      code: 'FILE_TOO_LARGE',
    });
  });

  it('400 for a body cut short, as the proxy would leave one sent without a length', async () => {
    const whole = formRequest((form) => form.append('file', new File(['Plain text.'], 'a.txt')));
    const bytes = new Uint8Array(await whole.clone().arrayBuffer());
    const cut = new Request(URL_, {
      method: 'POST',
      headers: { 'content-type': whole.headers.get('content-type') ?? '' },
      body: bytes.slice(0, bytes.length - 10),
    });
    expect(await refusal(readUpload(cut, options))).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it.each<[string, (form: FormData) => void]>([
    ['no file', (form) => form.append('options', '{}')],
    [
      'two files',
      (form) => {
        form.append('file', new File(['a'], 'a.txt'));
        form.append('file', new File(['b'], 'b.txt'));
      },
    ],
    ['a file part that is text', (form) => form.append('file', 'not a file')],
    ['a file with no name', (form) => form.append('file', new File(['a'], '   '))],
    [
      'a file name over 255 characters',
      (form) => form.append('file', new File(['a'], `${'a'.repeat(252)}.txt`)),
    ],
    [
      'an unknown part',
      (form) => {
        form.append('file', new File(['a'], 'a.txt'));
        form.append('title', 'Launch');
      },
    ],
    [
      'options that are not JSON',
      (form) => {
        form.append('file', new File(['a'], 'a.txt'));
        form.append('options', '{title:');
      },
    ],
    [
      'options sent as a file',
      (form) => {
        form.append('file', new File(['a'], 'a.txt'));
        form.append('options', new File(['{}'], 'options.json'));
      },
    ],
    [
      'two options parts',
      (form) => {
        form.append('file', new File(['a'], 'a.txt'));
        form.append('options', '{}');
        form.append('options', '{}');
      },
    ],
    [
      'options over the length limit',
      (form) => {
        form.append('file', new File(['a'], 'a.txt'));
        form.append('options', JSON.stringify({ title: 'x'.repeat(MAX_OPTIONS_CHARS) }));
      },
    ],
  ])('400 VALIDATION_ERROR for %s', async (_case, build) => {
    expect(await refusal(readUpload(formRequest(build), options))).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('reports options that do not fit by their path under options', async () => {
    const request = formRequest((form) => {
      form.append('file', new File(['a'], 'a.txt'));
      form.append('options', JSON.stringify({ title: '', extra: 1 }));
    });
    const err = await readUpload(request, options).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIError);
    const details = z
      .object({ errors: z.array(z.object({ path: z.string(), message: z.string() })) })
      .parse((err as APIError).details);
    expect(details.errors.map((e) => e.path)).toEqual(
      expect.arrayContaining(['options.title', 'options'])
    );
  });
});
