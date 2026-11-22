// @vitest-environment happy-dom

/**
 * Tests: the API reference on `/developers` (t-45).
 *
 * The reference is rendered from the generated OpenAPI document, so it must
 * list every operation the document has. The expectation is read from the
 * document's `paths` directly, not through the page's own parser, so a route
 * the parser or the renderer drops fails here.
 *
 * @see components/app/developers/api-reference.tsx
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/lib/env', () => ({ env: { NODE_ENV: 'test' } }));

import { openApiDocument, type OpenApiDocument } from '@/lib/app/api/openapi';
import { ApiReference } from '@/components/app/developers/api-reference';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

/** `METHOD /path` for every operation in the document. */
function documentOperations(doc: OpenApiDocument): string[] {
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.keys(item)
      .filter((key) => METHODS.includes(key))
      .map((method) => `${method.toUpperCase()} ${path}`)
  );
}

function renderedOperations(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-operation]')].map(
    (el) => el.getAttribute('data-operation') ?? ''
  );
}

describe('ApiReference', () => {
  const doc = openApiDocument();

  it('lists every operation in the generated document, once', () => {
    const expected = documentOperations(doc);
    expect(expected.length).toBeGreaterThan(20);

    const { container } = render(<ApiReference document={doc} />);

    expect(renderedOperations(container).sort()).toEqual([...expected].sort());
  });

  it('lists a route added to the document, and drops one taken out', () => {
    const added: OpenApiDocument = {
      ...doc,
      paths: {
        ...doc.paths,
        '/api/v1/example': {
          get: { operationId: 'get_example', summary: 'An example.', responses: {} },
        },
      },
    };
    const { container, unmount } = render(<ApiReference document={added} />);
    expect(renderedOperations(container)).toContain('GET /api/v1/example');
    unmount();

    const { '/api/v1/openapi.json': _gone, ...rest } = doc.paths;
    const { container: without } = render(<ApiReference document={{ ...doc, paths: rest }} />);
    expect(renderedOperations(without)).not.toContain('GET /api/v1/openapi.json');
  });

  it("shows a route's request body fields and who may call it", () => {
    const { container } = render(<ApiReference document={doc} />);
    const create = container.querySelector('[data-operation="POST /api/v1/assessments"]');

    expect(create?.textContent).toContain('Key scope: assess');
    expect(create?.textContent).toContain('Request body');
    const names = [...(create?.querySelectorAll('code') ?? [])].map((c) => c.textContent);
    for (const field of ['source', 'context', 'profile', 'judges', 'wait', 'store']) {
      expect(names).toContain(field);
    }

    const openapi = container.querySelector('[data-operation="GET /api/v1/openapi.json"]');
    expect(openapi?.textContent).toContain('No key needed');
    // The model is IP (t-67): the frameworks routes need a key, and the model is admin only.
    const frameworks = container.querySelector('[data-operation="GET /api/v1/frameworks"]');
    expect(frameworks?.textContent).toContain('Key scope: assess');
    const model = container.querySelector(
      '[data-operation="GET /api/v1/frameworks/{slug}/versions/{version}"]'
    );
    expect(model?.textContent).not.toContain('No key needed');
    // The quick scan takes a key, or a free review code in place of one (t-61).
    const scan = container.querySelector('[data-operation="POST /api/v1/scan"]');
    expect(scan?.textContent).toContain('Key scope: assess');
    expect(scan?.textContent).toContain('a free review code');
    const workspace = container.querySelector('[data-operation="POST /api/v1/workspaces"]');
    expect(workspace?.textContent).toContain('Browser session only');
  });

  it("links every reference to a named schema to that schema's entry", () => {
    const { container } = render(<ApiReference document={doc} />);
    const targets = [...container.querySelectorAll('a[href^="#schema-"]')].map((a) =>
      (a.getAttribute('href') ?? '').slice(1)
    );

    expect(targets.length).toBeGreaterThan(0);
    for (const id of new Set(targets)) {
      expect(container.querySelector(`[id="${id}"]`), id).not.toBeNull();
    }
  });

  it("links every route in the index to the route's entry", () => {
    const { container } = render(<ApiReference document={doc} />);
    const links = [...container.querySelectorAll('nav a[href^="#op-"]')];

    expect(links).toHaveLength(documentOperations(doc).length);
    for (const link of links) {
      const id = (link.getAttribute('href') ?? '').slice(1);
      expect(container.querySelector(`[id="${id}"]`), id).not.toBeNull();
    }
  });
});

describe('a schema with a boolean subschema', () => {
  it('renders the field as any rather than failing the page', () => {
    const odd: OpenApiDocument = {
      ...openApiDocument(),
      paths: {
        '/api/v1/odd': {
          post: {
            operationId: 'post_odd',
            summary: 'Odd.',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { anything: true, name: { type: 'string' } },
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
    };
    const { container } = render(<ApiReference document={odd} />);
    const entry = container.querySelector('[data-operation="POST /api/v1/odd"]');
    expect(entry?.textContent).toContain('anything');
    expect(entry?.textContent).toContain('name');
  });
});

describe('what a field shows', () => {
  const doc = openApiDocument();

  it("leaves out zod's ±MAX_SAFE_INTEGER bounds on integers, and keeps real ones", () => {
    const { container } = render(<ApiReference document={doc} />);
    expect(container.textContent).not.toContain(String(Number.MAX_SAFE_INTEGER));

    const list = container.querySelector('[data-operation="GET /api/v1/assessments"]');
    expect(list?.textContent).toContain('1–100');
  });

  it('labels a nullable field as its type or null, linked to the named schema', () => {
    const { container } = render(<ApiReference document={doc} />);
    const detail = container.querySelector('[data-operation="GET /api/v1/assessments/{id}"]');
    const link = [...(detail?.querySelectorAll('a') ?? [])].find(
      (a) => a.textContent === 'AssessmentResult | null'
    );

    expect(link).toHaveAttribute('href', '#schema-AssessmentResult');
  });

  it("shows a field's pattern and exclusive bounds", () => {
    const odd: OpenApiDocument = {
      ...doc,
      paths: {
        '/api/v1/odd': {
          post: {
            operationId: 'post_odd',
            summary: 'Odd.',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      slug: { type: 'string', pattern: '^[a-z]+$' },
                      weight: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 },
                      at: { type: 'string', format: 'date-time', pattern: '^LONG-REGEX$' },
                      grid: {
                        type: 'array',
                        items: {
                          type: 'array',
                          items: { type: 'object', properties: { cell: { type: 'string' } } },
                        },
                      },
                    },
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
    };
    const { container } = render(<ApiReference document={odd} />);
    const text = container.textContent ?? '';
    expect(text).toContain('pattern ^[a-z]+$');
    expect(text).toContain('> 0');
    expect(text).toContain('< 1');
    expect(text).toContain('date-time');
    expect(text).not.toContain('LONG-REGEX');
    expect(text).toContain('array of array of object');
    expect(text).toContain('cell');
    expect(text).not.toContain('Nested further');
  });
});
