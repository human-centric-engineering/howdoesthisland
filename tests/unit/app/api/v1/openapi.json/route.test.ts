/**
 * Tests: GET /api/v1/openapi.json (t-44) — the registry's document, bare,
 * with a conditional GET.
 *
 * @see app/api/v1/openapi.json/route.ts
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ env: { NODE_ENV: 'test' } }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/v1/openapi.json/route';
import { buildOpenApiDocument } from '@/lib/app/api/openapi';

const URL = 'http://localhost/api/v1/openapi.json';

describe('GET /api/v1/openapi.json', () => {
  it('answers the document itself, not the envelope, with an ETag', async () => {
    const res = GET(new Request(URL));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('etag')).toMatch(/^W\/".+"$/);
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    const body: unknown = await res.json();
    expect(body).toEqual(buildOpenApiDocument());
    expect(body).not.toHaveProperty('success');
  });

  it('answers 304 with no body when If-None-Match holds the ETag', async () => {
    const etag = GET(new Request(URL)).headers.get('etag') ?? '';
    const res = GET(new Request(URL, { headers: { 'If-None-Match': etag } }));
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe(etag);
    expect(await res.text()).toBe('');
  });

  it('answers 200 for a stale ETag', () => {
    const res = GET(new Request(URL, { headers: { 'If-None-Match': 'W/"old"' } }));
    expect(res.status).toBe(200);
  });
});
