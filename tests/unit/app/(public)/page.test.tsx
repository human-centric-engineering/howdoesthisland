// @vitest-environment happy-dom

/**
 * Tests: `/`, HowDoesThisLand's landing page (t-62).
 *
 * The route is a shim, so this imports it as Next does and renders what it
 * re-exports. The quick scan's service is mocked at its module, so "no
 * quick-scan call" is checked where a call would have to go.
 *
 * @see components/app/marketing/home-page.tsx · app/(public)/page.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: vi.fn(() => Promise.resolve()),
}));
const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'test',
  QUICK_SCAN_ENABLED: undefined as boolean | undefined,
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const runQuickScan = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/assessments/api/scan', () => ({ runQuickScan }));

import HomePage, { metadata } from '@/app/(public)/page';
import { HOME_CONTEXT, HOME_PAGE_TEXT } from '@/components/app/marketing/home-copy';

beforeEach(() => {
  vi.clearAllMocks();
  runQuickScan.mockResolvedValue({
    framework: { slug: 'howdoesthisland', version: '0.5.1' },
    wordCount: 500,
    overall: 63,
    band: 'Solid',
    context: HOME_CONTEXT,
    result: {
      scores: { overall: 63, band: 'Solid', ethos: 71, pathos: 50, logos: 73, kairos: 69 },
    },
  });
});

describe('the landing page', () => {
  it('renders per request, so the switch and the score are the running server’s', async () => {
    mockEnv.QUICK_SCAN_ENABLED = false;
    const { connection } = await import('next/server');
    await HomePage();
    expect(connection).toHaveBeenCalled();
  });

  it('with the switch on, shows its own copy’s quick-scan score, rendered on the server', async () => {
    mockEnv.QUICK_SCAN_ENABLED = true;
    const { container } = render(await HomePage());

    expect(runQuickScan).toHaveBeenCalledWith({ text: HOME_PAGE_TEXT, context: HOME_CONTEXT });
    const panel = screen.getByTestId('self-score');
    expect(panel).toHaveTextContent('We ran this page through HowDoesThisLand');
    expect(panel).toHaveTextContent('63');
    expect(panel).toHaveTextContent('Weakest appeal: pathos.');
    expect(container.querySelector('[data-testid="sample-mark-up"]')).toBeNull();
  });

  it('with the switch off, makes no quick-scan call and shows no quick-scan output', async () => {
    mockEnv.QUICK_SCAN_ENABLED = false;
    const { container } = render(await HomePage());

    expect(runQuickScan).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="self-score"]')).toBeNull();
    expect(container.textContent).not.toMatch(/quick scan/i);
    expect(screen.getByTestId('sample-mark-up')).toHaveTextContent('What a review marks up');
  });

  it('falls back to the sample when the self-score cannot run', async () => {
    mockEnv.QUICK_SCAN_ENABLED = true;
    runQuickScan.mockRejectedValue(new Error('no published version'));
    render(await HomePage());
    expect(screen.getByTestId('sample-mark-up')).toBeInTheDocument();
  });

  it('sends “Have a code?” and the code box to /redeem', async () => {
    mockEnv.QUICK_SCAN_ENABLED = false;
    const { container } = render(await HomePage());

    const links = screen.getAllByRole('link', { name: 'Have a code? Get your free review' });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/redeem');

    const form = container.querySelector('form');
    expect(form).toHaveAttribute('action', '/redeem');
    expect(form).toHaveAttribute('method', 'get');
    expect(form?.querySelector('input[name="code"]')).not.toBeNull();
  });

  it('offers sign-up without a code, second', async () => {
    mockEnv.QUICK_SCAN_ENABLED = false;
    render(await HomePage());
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/signup'
    );
  });

  it('never calls the free offer a scan, and counts nine AI reviewers', async () => {
    mockEnv.QUICK_SCAN_ENABLED = false;
    const { container } = render(await HomePage());
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/free (quick )?scan|10 seconds|six judges/i);
    expect(text).toContain('Nine AI reviewers');
  });

  it('declares its title, description and social cards', () => {
    expect(metadata.title).toEqual({
      absolute: 'HowDoesThisLand: find out why your words aren’t landing',
    });
    expect(metadata.description).toMatch(/Nine AI reviewers/);
    expect(metadata.openGraph).toMatchObject({ type: 'website' });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' });
  });
});
