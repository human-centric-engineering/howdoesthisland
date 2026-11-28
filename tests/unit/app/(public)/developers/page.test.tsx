// @vitest-environment happy-dom

/**
 * Tests: `/developers` (t-45, webhooks t-100).
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
const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'test' as const,
  NEXT_PUBLIC_APP_URL: 'https://docs.example.test',
  QUICK_SCAN_ENABLED: undefined as boolean | undefined,
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

import DevelopersPage, { metadata } from '@/app/(public)/developers/page';
import { RECIPES } from '@/components/app/developers/recipes';
import { VERIFY_SAMPLE } from '@/components/app/developers/webhooks';
import { SECURITY_CONSTANTS } from '@/lib/security/constants';
import { AI_ASSESSMENTS_PER_MINUTE } from '@/lib/app/assessments/limits';

const SCAN = 'POST /api/v1/scan';

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
      ['webhooks', 'Webhooks'],
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

  it('documents webhooks: both events, the tested verify sample, and where to add one (t-100)', async () => {
    const { container } = render(await DevelopersPage());
    const section = container.querySelector('section#webhooks') as HTMLElement;
    const scoped = within(section);
    expect(scoped.getByText('app.assessment.finished')).toBeInTheDocument();
    expect(scoped.getAllByText('app.comparison.finished').length).toBeGreaterThan(0);
    const codes = [...section.querySelectorAll('pre code')].map((c) => c.textContent);
    expect(codes).toContain(VERIFY_SAMPLE);
    expect(scoped.getByRole('link', { name: 'Webhooks' })).toHaveAttribute(
      'href',
      '/settings/webhooks'
    );
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

  it('lists the quick scan, its route and its cap, only while its switch is on (t-61)', async () => {
    mockEnv.QUICK_SCAN_ENABLED = true;
    const on = render(await DevelopersPage());
    const operations = (el: HTMLElement) =>
      [...el.querySelectorAll('[data-operation]')].map((op) => op.getAttribute('data-operation'));
    expect(operations(on.container)).toContain(SCAN);
    expect(on.container.querySelector('#errors-and-limits')?.textContent).toContain('/api/v1/scan');
    on.unmount();

    mockEnv.QUICK_SCAN_ENABLED = false;
    const off = render(await DevelopersPage());
    expect(operations(off.container)).not.toContain(SCAN);
    // Nowhere on the page: not the reference, the scope lists or the limits.
    expect(off.container.textContent).not.toContain('/api/v1/scan');
    off.unmount();
    mockEnv.QUICK_SCAN_ENABLED = undefined;
  });
});
