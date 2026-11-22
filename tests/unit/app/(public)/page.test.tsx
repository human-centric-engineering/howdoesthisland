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
import { cloneElement, isValidElement, Suspense, type ReactElement, type ReactNode } from 'react';
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

const findFramework = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/frameworks/api/catalog', () => ({
  prismaFrameworkCatalog: { findFramework },
}));

import { HOME_CONTEXT, HOME_PAGE_TEXT } from '@/components/app/marketing/home-copy';

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
 * Suspense boundary is kept so its fallback can be checked. Testing Library
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

/** The Suspense boundaries in a tree, before anything inside them resolves. */
function boundaries(node: ReactNode): ReactElement<AnyProps>[] {
  if (Array.isArray(node)) return node.flatMap(boundaries);
  if (!isValidElement<AnyProps>(node)) return [];
  const inner = boundaries(node.props.children);
  return node.type === Suspense ? [node, ...inner] : inner;
}

beforeEach(async () => {
  vi.clearAllMocks();
  // The self-score is kept per framework version in module state: each test starts with none.
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
    context: HOME_CONTEXT,
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

  it('with the switch on, shows its own copy’s quick-scan score, rendered on the server', async () => {
    mockEnv.QUICK_SCAN_ENABLED = true;
    const { container } = render(await page());

    expect(runQuickScan).toHaveBeenCalledWith({
      text: HOME_PAGE_TEXT,
      context: HOME_CONTEXT,
      version: '0.5.1',
    });
    const panel = screen.getByTestId('self-score');
    expect(panel).toHaveTextContent('We ran this page through HowDoesThisLand');
    expect(panel).toHaveTextContent('63');
    expect(panel).toHaveTextContent('Weakest appeal: pathos.');
    expect(container.querySelector('[data-testid="sample-mark-up"]')).toBeNull();
  });

  it('with the switch off, makes no quick-scan call and shows no quick-scan output', async () => {
    mockEnv.QUICK_SCAN_ENABLED = false;
    const { container } = render(await page());

    expect(runQuickScan).not.toHaveBeenCalled();
    expect(findFramework).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="self-score"]')).toBeNull();
    expect(container.textContent).not.toMatch(/quick scan/i);
    expect(screen.getByTestId('sample-mark-up')).toHaveTextContent('What a review marks up');
  });

  it('streams the panel under its own boundary, with the sample standing in', async () => {
    mockEnv.QUICK_SCAN_ENABLED = true;
    // The shell renders without waiting on the score.
    findFramework.mockReturnValue(new Promise(() => {}));
    const [panel] = boundaries(await HomePage());

    expect(panel).toBeDefined();
    render(<>{panel.props.fallback}</>);
    expect(screen.getByTestId('sample-mark-up')).toBeInTheDocument();
  });

  it('falls back to the sample when the self-score cannot run', async () => {
    mockEnv.QUICK_SCAN_ENABLED = true;
    runQuickScan.mockRejectedValue(new Error('no published version'));
    render(await page());
    expect(screen.getByTestId('sample-mark-up')).toBeInTheDocument();
  });

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
