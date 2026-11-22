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
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: vi.fn(() => Promise.resolve()),
  after: vi.fn(),
}));
const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'test',
  QUICK_SCAN_ENABLED: undefined as boolean | undefined,
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const runQuickScan = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/assessments/api/scan', () => ({ runQuickScan }));

const findFramework = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/frameworks/api/catalog', () => ({
  prismaFrameworkCatalog: { findFramework },
}));

type PageModule = typeof import('@/app/(public)/page');
let HomePage: PageModule['default'];
let metadata: PageModule['metadata'];

type AnyProps = { children?: ReactNode; fallback?: ReactNode };

function isAsyncComponent(type: unknown): type is (props: AnyProps) => Promise<ReactNode> {
  return typeof type === 'function' && type.constructor.name === 'AsyncFunction';
}

/**
 * The tree as the server sends it once every boundary has resolved: each
 * async component is awaited in place, as Next does on the server, and a
 * boundary is kept as it is. Testing Library
 * renders on the client, which cannot await an async component itself.
 */
async function resolved(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolved));
  if (!isValidElement<AnyProps>(node)) return node;
  if (isAsyncComponent(node.type)) return resolved(await node.type(node.props));
  if (node.props.children === undefined) return node;
  return cloneElement(node, undefined, await resolved(node.props.children));
}

async function page(): Promise<ReactElement> {
  const tree = await resolved(await HomePage());
  if (!isValidElement(tree)) throw new Error('HomePage rendered no element');
  return tree;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  ({ default: HomePage, metadata } = await import('@/app/(public)/page'));
  findFramework.mockResolvedValue({
    slug: 'howdoesthisland',
    versions: [{ id: 'v51', version: '0.5.1', status: 'PUBLISHED', sourceSha256: 'sha' }],
  });
  runQuickScan.mockResolvedValue({
    framework: { slug: 'howdoesthisland', version: '0.5.1' },
    wordCount: 500,
    overall: 63,
    band: 'Solid',
    context: {},
    result: {
      scores: { overall: 63, band: 'Solid', ethos: 71, pathos: 50, logos: 73, kairos: 69 },
    },
  });
});

describe('the landing page', () => {
  it('renders per request, so the switch is the running server’s', async () => {
    mockEnv.QUICK_SCAN_ENABLED = false;
    const { connection } = await import('next/server');
    await HomePage();
    expect(connection).toHaveBeenCalled();
  });

  it.each([true, false])(
    'shows the sample email, opening the full example, with the quick-scan switch %s (t-69)',
    async (on) => {
      mockEnv.QUICK_SCAN_ENABLED = on;
      render(await page());
      expect(screen.getByTestId('sample-mark-up')).toHaveTextContent('What a review marks up');
      expect(screen.getByTestId('sample-mark-up-link')).toHaveAttribute('href', '/example-review');
      // The hero no longer scores the page's own copy.
      expect(runQuickScan).not.toHaveBeenCalled();
      expect(findFramework).not.toHaveBeenCalled();
      expect(screen.queryByTestId('self-score')).toBeNull();
    }
  );

  it('sends “Have a code?” and the code box to /redeem', async () => {
    mockEnv.QUICK_SCAN_ENABLED = false;
    const { container } = render(await page());

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
    render(await page());
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/signup'
    );
  });

  it('with the switch on, offers the free quick scan beside sign-up (t-68)', async () => {
    mockEnv.QUICK_SCAN_ENABLED = true;
    runQuickScan.mockRejectedValue(new Error('not needed here'));
    render(await page());
    expect(screen.getByTestId('hero-quick-scan')).toHaveAttribute('href', '/quick-scan');
    expect(screen.getByRole('link', { name: 'create an account' })).toHaveAttribute(
      'href',
      '/signup'
    );
    // The free review is still the code's: the redeem button is unchanged.
    expect(
      screen.getAllByRole('link', { name: 'Have a code? Get your free review' })[0]
    ).toHaveAttribute('href', '/redeem');
  });

  it('never calls the free offer a scan, and never counts the AI reviewers', async () => {
    mockEnv.QUICK_SCAN_ENABLED = false;
    const { container } = render(await page());
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/free (quick )?scan|10 seconds/i);
    // The panel can change, so the page names it without a number.
    expect(text).toContain('A panel of AI reviewers');
    expect(text).not.toMatch(
      /\b(two|three|four|five|six|seven|eight|nine|ten|\d+) (AI )?(reviewers|judges)\b/i
    );
  });

  it('declares its title, description and social cards', () => {
    expect(metadata.title).toEqual({
      absolute: 'HowDoesThisLand: find out why your words aren’t landing',
    });
    expect(metadata.description).toMatch(/A panel of AI reviewers/);
    expect(metadata.description).not.toMatch(/\bnine\b/i);
    expect(metadata.openGraph).toMatchObject({ type: 'website' });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' });
  });
});
