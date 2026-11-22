// @vitest-environment happy-dom

/**
 * Tests: the model as browsable pages, and `/about` (t-63).
 *
 * The routes are imported as Next imports them. The framework API's service
 * runs for real over model 0.5.1: only the catalog's query and the
 * materialise step are stubbed, with the published version and the imported
 * file (which the materialised model equals). So "every cross-link resolves"
 * is checked over the rendered pages themselves: every link on every section
 * page of 0.5.1 lands on an anchor that is on the page it names.
 *
 * @see components/app/model/model-pages.tsx · app/(public)/model/
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneElement, isValidElement, type ReactNode } from 'react';
import { cleanup, render } from '@testing-library/react';

// The global setup makes notFound() a no-op; here it throws, as Next's does.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));

const mockEnv = vi.hoisted(
  (): { NODE_ENV: string; CULTURE_MODULE_ENABLED: boolean | undefined } => ({
    NODE_ENV: 'test',
    CULTURE_MODULE_ENABLED: true,
  })
);
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const MODEL = vi.hoisted((): { value: Record<string, unknown> } => ({ value: {} }));
const findFramework = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/frameworks/api/catalog', () => ({
  prismaFrameworkCatalog: { findFramework, listFrameworks: vi.fn() },
}));
const materialise = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/frameworks/store', () => ({ materialise }));

import { __resetModelCacheForTests } from '@/components/app/model/load';
import ModelIndex, { generateMetadata as indexMetadata } from '@/app/(public)/model/page';
import ModelSection, {
  generateMetadata as sectionMetadata,
} from '@/app/(public)/model/[section]/page';
import VersionIndex, {
  generateMetadata as versionIndexMetadata,
} from '@/app/(public)/model/v/[version]/page';
import VersionSection, {
  generateMetadata as versionSectionMetadata,
} from '@/app/(public)/model/v/[version]/[section]/page';
import AboutPage, { metadata as aboutMetadata } from '@/app/(public)/about/page';
import { ABOUT_COPY } from '@/components/app/marketing/about-copy';

MODEL.value = JSON.parse(
  readFileSync('lib/app/frameworks/howdoesthisland/data/model-0.5.1.json', 'utf8')
) as Record<string, unknown>;

const version = (v: string, status: 'PUBLISHED' | 'RETIRED', publishedAt: string) => ({
  id: `id-${v}`,
  version: v,
  schemaVersion: '4',
  status,
  publishedAt: new Date(publishedAt),
  sourceSha256: 'sha',
});

function serve(...versions: ReturnType<typeof version>[]) {
  findFramework.mockResolvedValue({
    slug: 'howdoesthisland',
    name: 'HowDoesThisLand',
    summary: 'S',
    versions,
  });
}

const params = <T,>(value: T) => ({ params: Promise.resolve(value) });

type AnyProps = { children?: ReactNode };

/** The tree as the server sends it: each async component awaited in place, as Next does. */
async function resolved(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolved));
  if (!isValidElement<AnyProps>(node)) return node;
  const { type } = node;
  if (typeof type === 'function' && type.constructor.name === 'AsyncFunction') {
    return resolved(await (type as (p: AnyProps) => Promise<ReactNode>)(node.props));
  }
  if (node.props.children === undefined) return node;
  return cloneElement(node, undefined, await resolved(node.props.children));
}

/** Render a route's page, after resolving it as the server would. Rejects as the page does (a 404). */
async function html(page: Promise<ReactNode> | ReactNode): Promise<HTMLElement> {
  const tree = await resolved(await page);
  cleanup();
  return render(<>{tree}</>).container;
}

/** The section segments the index links to, read off the rendered index. */
function sectionLinks(container: HTMLElement, base: string): string[] {
  return [...container.querySelectorAll<HTMLAnchorElement>(`a[href^="${base}/"]`)]
    .map((a) => a.getAttribute('href')!)
    .filter((href) => !href.includes('#') && !href.slice(base.length + 1).includes('/'))
    .map((href) => href.slice(base.length + 1));
}

beforeEach(() => {
  __resetModelCacheForTests();
  findFramework.mockReset();
  materialise.mockReset();
  materialise.mockImplementation(() => Promise.resolve(structuredClone(MODEL.value)));
  mockEnv.CULTURE_MODULE_ENABLED = true;
  serve(version('0.5.1', 'PUBLISHED', '2026-11-12T21:50:46Z'));
});

describe('/model and its sections over 0.5.1', () => {
  it('links every cross-reference to an anchor on the page it names', async () => {
    const index = await html(ModelIndex());
    const segments = sectionLinks(index, '/model');
    expect(segments).toEqual(expect.arrayContaining(['appeals', 'dimensions', 'moves', 'culture']));

    const anchors = new Map<string, Set<string>>();
    const hrefs: string[] = [];
    for (const segment of segments) {
      const page = await html(ModelSection(params({ section: segment })));
      anchors.set(
        segment,
        new Set([...page.querySelectorAll('[data-model-record]')].map((e) => e.id))
      );
      for (const a of page.querySelectorAll<HTMLAnchorElement>('a[data-model-link]')) {
        hrefs.push(a.getAttribute('href')!);
      }
    }

    expect(hrefs.length).toBeGreaterThan(1000);
    const unresolved = hrefs.filter((href) => {
      const match = /^\/model\/([^/#]+)#(.+)$/.exec(href);
      return !match || !anchors.get(match[1])?.has(match[2]);
    });
    expect(unresolved).toEqual([]);
    // Each anchor appears once on its page.
    for (const [segment, set] of anchors) {
      const page = await html(ModelSection(params({ section: segment })));
      expect(page.querySelectorAll('[data-model-record]').length, segment).toBe(set.size);
    }
  });

  it('reads counts from the version, not from copy', async () => {
    const index = await html(ModelIndex());
    const featured = index.querySelector('[data-testid="model-featured"]')!;
    const dimensions = (MODEL.value.dimensions as unknown[]).length;
    expect(featured.textContent).toContain(`${dimensions} dimensions`);
    expect(index.querySelector('[data-testid="model-version"]')!.textContent).toContain(
      'Version 0.5.1, published 12 November 2026.'
    );
  });

  it('names a section in its metadata, and 404s a section the version does not have', async () => {
    expect((await sectionMetadata(params({ section: 'red-flags' }))).title).toBe(
      'Red flags: the model'
    );
    await expect(html(ModelSection(params({ section: 'nope' })))).rejects.toThrow('NOT_FOUND');
  });
});

describe('the culture switch', () => {
  it('shows culture with the switch on', async () => {
    const index = await html(ModelIndex());
    expect(sectionLinks(index, '/model')).toContain('culture');
    const page = await html(ModelSection(params({ section: 'culture' })));
    expect(page.querySelector('[data-model-record="culture_country:us"]')).not.toBeNull();
  });

  it('withholds it with the switch off: not on the index, and a 404', async () => {
    mockEnv.CULTURE_MODULE_ENABLED = false;
    const index = await html(ModelIndex());
    expect(sectionLinks(index, '/model')).not.toContain('culture');
    expect(index.textContent).not.toContain('Hofstede');
    await expect(html(ModelSection(params({ section: 'culture' })))).rejects.toThrow('NOT_FOUND');
  });
});

describe('versions', () => {
  it('shows a newly published version at /model as soon as the catalog has it', async () => {
    serve(
      version('0.6.0', 'PUBLISHED', '2026-12-01T10:00:00Z'),
      version('0.5.1', 'PUBLISHED', '2026-11-12T21:50:46Z')
    );
    const index = await html(ModelIndex());
    expect(index.querySelector('[data-testid="model-version"]')!.textContent).toContain(
      'Version 0.6.0'
    );
    expect(materialise).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'id-0.6.0');
  });

  it('pins an older version under /model/v/{version}, with its links kept in that version', async () => {
    serve(
      version('0.6.0', 'PUBLISHED', '2026-12-01T10:00:00Z'),
      version('0.5.1', 'RETIRED', '2026-11-12T21:50:46Z')
    );
    const index = await html(VersionIndex(params({ version: '0.5.1' })));
    const line = index.querySelector('[data-testid="model-version"]')!.textContent;
    expect(line).toContain('Version 0.5.1');
    expect(line).toContain('This version is retired.');
    expect(line).toContain('The latest is version 0.6.0');
    expect(sectionLinks(index, '/model/v/0.5.1')).toContain('moves');

    const moves = await html(VersionSection(params({ version: '0.5.1', section: 'moves' })));
    const links = [...moves.querySelectorAll('a[data-model-link]')].map((a) =>
      a.getAttribute('href')
    );
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((href) => href!.startsWith('/model/v/0.5.1/'))).toBe(true);
  });

  it('names the version in a pinned page’s metadata, and the latest without one', async () => {
    expect(indexMetadata().title).toBe('The model');
    expect((await versionIndexMetadata(params({ version: '0.5.1' }))).title).toBe(
      'The model, version 0.5.1'
    );
    expect(
      (await versionSectionMetadata(params({ version: '0.5.1', section: 'moves' }))).title
    ).toBe('Moves: the model, version 0.5.1');
    expect((await sectionMetadata(params({ section: 'nope' }))).title).toBe('The model');
  });

  it('404s a version that is not published', async () => {
    await expect(html(VersionIndex(params({ version: '9.9.9' })))).rejects.toThrow('NOT_FOUND');
  });

  it('says so, rather than 404ing, when nothing is published yet', async () => {
    findFramework.mockResolvedValue(null);
    const index = await html(ModelIndex());
    expect(index.textContent).toContain('The model has not been published here yet.');
  });

  it('builds a version once, however many pages read it', async () => {
    await html(ModelSection(params({ section: 'appeals' })));
    await html(ModelSection(params({ section: 'moves' })));
    expect(materialise).toHaveBeenCalledTimes(1);
  });
});

describe('/about', () => {
  it('renders the About copy, with the way in and a link to the model, and reads no model', async () => {
    const page = await html(AboutPage());
    expect(page.querySelector('h1')!.textContent).toBe(ABOUT_COPY.h1);
    expect(page.textContent).toContain(ABOUT_COPY.unknowable);
    for (const q of ABOUT_COPY.qualities) expect(page.textContent).toContain(q.name);
    expect(page.querySelector('[data-testid="about-redeem"]')!.getAttribute('href')).toBe(
      '/redeem'
    );
    expect(page.querySelector('a[href="/model"]')).not.toBeNull();
    expect(findFramework).not.toHaveBeenCalled();
    expect(aboutMetadata.title).toBe('About');
  });
});
