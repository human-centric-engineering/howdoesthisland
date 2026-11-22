// @vitest-environment happy-dom

/**
 * Tests: how a review works, the model in human terms (t-63), and `/about`.
 *
 * The routes are imported as Next imports them. They read the explainer
 * (`lib/app/explainer/`), never the model, so nothing is stubbed but
 * `notFound()`, which the global setup makes a no-op.
 *
 * @see components/app/model/explainer-pages.tsx · app/(public)/model/
 */
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));

import HubRoute, { metadata as hubMetadata } from '@/app/(public)/model/page';
import ChapterRoute, {
  generateMetadata as chapterMetadata,
} from '@/app/(public)/model/[chapter]/page';
import SourcesRoute, { metadata as sourcesMetadata } from '@/app/(public)/model/sources/page';
import AboutPage, { metadata as aboutMetadata } from '@/app/(public)/about/page';
import { CHAPTERS } from '@/lib/app/explainer/chapters';
import { SOURCES } from '@/lib/app/explainer/sources';
import { ABOUT_COPY } from '@/components/app/marketing/about-copy';

const params = (chapter: string) => ({ params: Promise.resolve({ chapter }) });

async function renderPage(node: Promise<React.ReactNode> | React.ReactNode): Promise<HTMLElement> {
  cleanup();
  return render(<>{await node}</>).container;
}

describe('/model', () => {
  it('lists every chapter, in order, each linked, with its own metadata', async () => {
    const page = await renderPage(HubRoute());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('How a review works');
    const links = [...page.querySelectorAll('[data-testid="model-chapters"] a')].map((a) =>
      a.getAttribute('href')
    );
    expect(links).toEqual(CHAPTERS.map((c) => `/model/${c.slug}`));
    expect(hubMetadata.alternates?.canonical).toBe('/model');
  });
});

describe('a chapter', () => {
  it.each(CHAPTERS.map((c) => [c.slug]))(
    '%s renders every entry, server-side, with its sources and no version number',
    async (slug) => {
      const c = CHAPTERS.find((x) => x.slug === slug)!;
      const page = await renderPage(ChapterRoute(params(slug)));
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(c.title);
      for (const g of c.groups) {
        expect(page.querySelector(`#${g.id}`), g.id).not.toBeNull();
        for (const e of g.entries) {
          const entry = page.querySelector(`details#${e.id}`);
          expect(entry, e.id).not.toBeNull();
          // The explanation is in the HTML even while folded away.
          expect(entry?.textContent).toContain(e.body[0]);
        }
      }
      expect(page.textContent).not.toMatch(/\b\d+\.\d+\.\d+\b/);
      const meta = await chapterMetadata(params(slug));
      expect(meta.title).toBe(c.title);
      expect(meta.alternates?.canonical).toBe(`/model/${slug}`);
    }
  );

  it('links on to the next chapter, and not past the last', async () => {
    const first = await renderPage(ChapterRoute(params(CHAPTERS[0].slug)));
    expect(first.querySelector(`a[href="/model/${CHAPTERS[1].slug}"]`)).not.toBeNull();
    const last = await renderPage(ChapterRoute(params(CHAPTERS.at(-1)!.slug)));
    expect(last.textContent).not.toContain('Next:');
  });

  it('gives Cicero’s duties their context, not just his name', async () => {
    await renderPage(ChapterRoute(params('the-whole-piece')));
    expect(
      screen.getByText(/Cicero, the Roman statesman and lawyer, wrote in De Oratore/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Source: Cicero, De Oratore/ })).toBeInTheDocument();
  });

  it('is a 404 for a chapter there is not', async () => {
    await expect(renderPage(ChapterRoute(params('nope')))).rejects.toThrow('NOT_FOUND');
    expect((await chapterMetadata(params('nope'))).title).toBe('How a review works');
  });
});

describe('/model/sources', () => {
  it('lists every source with who, when and why, each at its own anchor', async () => {
    const page = await renderPage(SourcesRoute());
    for (const s of SOURCES) {
      const item = page.querySelector(`[data-testid="model-sources"] li[id="${s.id}"]`);
      expect(item, s.id).not.toBeNull();
      expect(item?.textContent).toContain(s.context);
    }
    expect(sourcesMetadata.alternates?.canonical).toBe('/model/sources');
  });
});

describe('/about', () => {
  it('renders the rationale, with its sources to open and the way in', async () => {
    const page = await renderPage(AboutPage());
    expect(page.querySelector('h1')?.textContent).toBe(ABOUT_COPY.h1);
    expect(page.textContent).toContain(ABOUT_COPY.unknowable);
    for (const q of ABOUT_COPY.qualities) expect(page.textContent).toContain(q.name);
    const chips = page.querySelectorAll('[data-testid="about-sources"] button');
    expect(chips).toHaveLength(ABOUT_COPY.sources.length);
    expect(page.querySelector('[data-testid="about-redeem"]')?.getAttribute('href')).toBe(
      '/redeem'
    );
    expect(page.querySelector('a[href="/model"]')).not.toBeNull();
    expect(page.textContent).not.toMatch(/\b\d+\.\d+\.\d+\b/);
    expect(aboutMetadata.title).toBe('About');
  });
});
