// @vitest-environment happy-dom

/**
 * Tests: sending a chosen file to an upload route (t-80).
 *
 * `fetch` is stubbed with answers shaped as the route's, and as a host's
 * that refuses the body before the route runs (Vercel's 413, which is not
 * the API's envelope).
 *
 * @see lib/app/intake/send-upload.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APIClientError } from '@/lib/api/client';
import { sendUpload } from '@/lib/app/intake/send-upload';

const TOO_LARGE = 'Too large for this server.';
const fetchMock = vi.fn<typeof fetch>();

function stubFetch(response: Response | Error) {
  if (response instanceof Error) fetchMock.mockRejectedValue(response);
  else fetchMock.mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
}

const envelope = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function refusal(promise: Promise<unknown>): Promise<APIClientError> {
  const err = await promise.catch((e: unknown) => e);
  if (!(err instanceof APIClientError)) throw new Error('expected an APIClientError');
  return err;
}

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('sendUpload', () => {
  it('posts the file as a file part and the options as JSON, and gives the data', async () => {
    stubFetch(envelope({ success: true, data: { id: 'a-1' } }, 202));
    const file = new File(['Hello'], 'brief.txt', { type: 'text/plain' });

    const data = await sendUpload('/api/v1/assessments', file, { profile: 'full' }, TOO_LARGE);

    expect(data).toEqual({ id: 'a-1' });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/assessments');
    expect(init?.method).toBe('POST');
    // The browser sets the multipart content type and its boundary.
    expect(new Headers(init?.headers).has('content-type')).toBe(false);
    const form = init?.body;
    if (!(form instanceof FormData)) throw new Error('expected a FormData body');
    const sent = form.get('file');
    expect(sent).toBeInstanceOf(File);
    expect(sent instanceof File && sent.name).toBe('brief.txt');
    expect(sent instanceof File && (await sent.text())).toBe('Hello');
    expect(form.get('options')).toBe('{"profile":"full"}');
  });

  it('throws the route’s refusal with its code, status and details', async () => {
    stubFetch(
      envelope(
        {
          success: false,
          error: { code: 'INVALID_FILE_TYPE', message: 'Not a format we read.', details: { a: 1 } },
        },
        415
      )
    );
    const err = await refusal(sendUpload('/x', new File(['x'], 'a.exe'), {}, TOO_LARGE));
    expect(err).toMatchObject({
      code: 'INVALID_FILE_TYPE',
      status: 415,
      message: 'Not a format we read.',
      details: { a: 1 },
    });
  });

  it('reports a host’s 413, which is not the envelope, as FILE_TOO_LARGE in the page’s words', async () => {
    stubFetch(new Response('Request Entity Too Large', { status: 413 }));
    const err = await refusal(sendUpload('/x', new File(['x'], 'a.pdf'), {}, TOO_LARGE));
    expect(err).toMatchObject({ code: 'FILE_TOO_LARGE', status: 413, message: TOO_LARGE });
  });

  it('keeps the route’s own 413 and its message', async () => {
    stubFetch(
      envelope({ success: false, error: { code: 'FILE_TOO_LARGE', message: 'Over 10 MB.' } }, 413)
    );
    const err = await refusal(sendUpload('/x', new File(['x'], 'a.pdf'), {}, TOO_LARGE));
    expect(err).toMatchObject({ code: 'FILE_TOO_LARGE', message: 'Over 10 MB.' });
  });

  it('NETWORK_ERROR when the request never lands', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    const err = await refusal(sendUpload('/x', new File(['x'], 'a.pdf'), {}, TOO_LARGE));
    expect(err).toMatchObject({ code: 'NETWORK_ERROR', message: 'Failed to fetch' });
  });

  it('INVALID_RESPONSE for a success that is not the envelope', async () => {
    stubFetch(new Response('<html>ok</html>', { status: 200 }));
    const err = await refusal(sendUpload('/x', new File(['x'], 'a.pdf'), {}, TOO_LARGE));
    expect(err).toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
  });
});
