// @vitest-environment happy-dom

/**
 * Tests: `/developers` (t-45).
 *
 * The page reads no session, so rendering it with nothing signed in is the
 * signed-out view. It has to carry each section the docs promise, a recipe
 * for each job, the reference, and the limits the limiters actually use.
 *
 * @see app/(public)/developers/page.tsx
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/env', () => ({
  env: { NODE_ENV: 'test', NEXT_PUBLIC_APP_URL: 'https://docs.example.test' },
}));

import DevelopersPage, { metadata } from '@/app/(public)/developers/page';
import { RECIPES } from '@/components/app/developers/recipes';
import { SECURITY_CONSTANTS } from '@/lib/security/constants';
import { AI_ASSESSMENTS_PER_MINUTE } from '@/lib/app/assessments/limits';

describe('DevelopersPage', () => {
  it('renders per request, so the limits are the running server’s', async () => {
    const { connection } = await import('next/server');
    await DevelopersPage();
    expect(connection).toHaveBeenCalled();
  });

  it('renders each section, signed out, with a working contents link to it', async () => {
    const { container } = render(await DevelopersPage());

    for (const [id, title] of [
      ['getting-started', 'Getting started'],
      ['authentication', 'Authentication'],
      ['errors-and-limits', 'Errors and limits'],
      ['recipes', 'Recipes'],
      ['reference', 'Reference'],
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
      expect(container.querySelector(`a[href="#${id}"]`)).not.toBeNull();
      expect(container.querySelector(`section#${id}`)).not.toBeNull();
    }
    expect(metadata.title).toBe('Developers');
  });

  it('puts the deployment’s own address in the getting-started example', async () => {
    render(await DevelopersPage());
    expect(screen.getByText(/export HDTL_URL="https:\/\/docs\.example\.test"/)).toBeInTheDocument();
  });

  it('points at the API keys page to make a key', async () => {
    render(await DevelopersPage());
    for (const link of screen.getAllByRole('link', { name: 'API keys' })) {
      expect(link).toHaveAttribute('href', '/settings/api-keys');
    }
  });

  it('shows every recipe, with its request and its script', async () => {
    const { container } = render(await DevelopersPage());
    for (const recipe of RECIPES) {
      const article = container.querySelector(`article#${recipe.id}`);
      expect(article, recipe.id).not.toBeNull();
      const scoped = within(article as HTMLElement);
      expect(scoped.getByRole('heading', { name: recipe.title })).toBeInTheDocument();
      expect(article?.textContent).toContain(`$HDTL_URL${recipe.path}`);
      if (recipe.script) expect(scoped.getByText(recipe.script.name)).toBeInTheDocument();
    }
  });

  it('lists the per-minute caps the limiters use', async () => {
    const { container } = render(await DevelopersPage());
    const limits = container.querySelector('#errors-and-limits')?.textContent ?? '';
    expect(limits).toContain(String(SECURITY_CONSTANTS.RATE_LIMIT.LIMITS.API));
    expect(limits).toContain(String(AI_ASSESSMENTS_PER_MINUTE));
    expect(limits).toContain('TEXT_TOO_LONG');
  });

  it('lists each scope with the routes that need it, linked into the reference', async () => {
    const { container } = render(await DevelopersPage());
    const auth = container.querySelector('#authentication') as HTMLElement;
    const link = within(auth).getAllByRole('link', { name: 'POST /api/v1/assessments' })[0];
    const target = link.getAttribute('href')?.slice(1) ?? '';
    expect(container.querySelector(`[id="${target}"]`)).not.toBeNull();
    expect(auth.textContent).toContain('Browser session only');
    expect(auth.textContent).toContain('No key needed');
  });

  it('lists every route that needs a caller under exactly one scope or session group', async () => {
    const { container } = render(await DevelopersPage());
    const auth = container.querySelector('#authentication') as HTMLElement;
    const listed = [...auth.querySelectorAll('a[href^="#op-"]')].map((a) => a.textContent);
    const reference = [...container.querySelectorAll('[data-operation]')].map((el) =>
      el.getAttribute('data-operation')
    );

    expect([...listed].sort()).toEqual([...reference].sort());
    expect(listed).toContain(
      'POST /api/v1/admin/frameworks/{slug}/versions/{version}/calibration-runs'
    );
  });
});
