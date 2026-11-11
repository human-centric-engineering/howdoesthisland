// @vitest-environment happy-dom

/**
 * Every design-lab page answers 404 outside development (t-3 done-when).
 * The directions themselves are stubbed: what is under test is the guard each
 * page calls before rendering anything.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const { notFoundError } = vi.hoisted(() => ({ notFoundError: new Error('NEXT_NOT_FOUND') }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw notFoundError;
  },
}));
vi.mock('@/components/app/design-lab/tyrian/tyrian', () => ({ TyrianDirection: () => null }));
vi.mock('@/components/app/design-lab/concord/concord', () => ({ ConcordDirection: () => null }));
vi.mock('@/components/app/design-lab/proof/proof', () => ({ ProofDirection: () => null }));

import { Children, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { DIRECTIONS, LabBar } from '@/components/app/design-lab/lab-frame';
import { TyrianDirection } from '@/components/app/design-lab/tyrian/tyrian';
import { ConcordDirection } from '@/components/app/design-lab/concord/concord';
import { ProofDirection } from '@/components/app/design-lab/proof/proof';

import DesignLabIndex from '@/app/(design-lab)/design-lab/page';
import TyrianPage from '@/app/(design-lab)/design-lab/tyrian/page';
import ConcordPage from '@/app/(design-lab)/design-lab/concord/page';
import ProofPage from '@/app/(design-lab)/design-lab/proof/page';

const searchParams = Promise.resolve({ theme: 'dark' });
const DIRECTIONS_BY_SLUG = {
  tyrian: TyrianDirection,
  concord: ConcordDirection,
  proof: ProofDirection,
} as const;
const directionPages = [
  ['tyrian', TyrianPage],
  ['concord', ConcordPage],
  ['proof', ProofPage],
] as const;

describe('design lab pages', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('the index answers 404 in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => DesignLabIndex()).toThrow(notFoundError);
  });

  it.each(directionPages)('/design-lab/%s answers 404 in production', async (_, Page) => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(Page({ searchParams })).rejects.toBe(notFoundError);
  });

  it.each(directionPages)(
    '/design-lab/%s renders its direction with the requested theme in development',
    async (slug, Page) => {
      vi.stubEnv('NODE_ENV', 'development');
      const page = await Page({ searchParams });
      const [bar, direction] = Children.toArray(page.props.children) as ReactElement<{
        current?: string;
        theme?: string;
      }>[];
      expect(bar.type).toBe(LabBar);
      expect(bar.props).toEqual({ current: slug, theme: 'dark' });
      expect(direction.type).toBe(DIRECTIONS_BY_SLUG[slug]);
      expect(direction.props).toEqual({ theme: 'dark' });
    }
  );

  it('the index renders a link to every direction in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    render(DesignLabIndex());
    for (const d of DIRECTIONS) {
      expect(screen.getByRole('link', { name: d.name })).toHaveAttribute(
        'href',
        `/design-lab/${d.slug}`
      );
    }
  });
});
