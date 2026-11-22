// @vitest-environment happy-dom

/**
 * Tests: `/example-review`, one cold email through a review (t-69).
 *
 * The engine, the report's schemas and `buildReportView` run for real over
 * model 0.5.1; only the version lookup and the model read are stubbed.
 *
 * @see components/app/example/example-page.tsx
 */
import { readdirSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockEnv = vi.hoisted((): { NODE_ENV: string; QUICK_SCAN_ENABLED: boolean | undefined } => ({
  NODE_ENV: 'test',
  QUICK_SCAN_ENABLED: true,
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));
const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: log }));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: vi.fn(() => Promise.resolve()),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
const mocks = vi.hoisted(() => ({ getFramework: vi.fn(), loadModel: vi.fn() }));
vi.mock('@/lib/app/frameworks/api/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/frameworks/api/service')>()),
  getFramework: mocks.getFramework,
}));
vi.mock('@/lib/app/reports/pdf/print-source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/reports/pdf/print-source')>()),
  loadModelDocument: mocks.loadModel,
}));

import ExampleRoute, { metadata } from '@/app/(public)/example-review/page';
import {
  __resetExampleCacheForTests,
  LOOKUP_TTL_MS,
  loadExampleViews,
} from '@/components/app/example/load';
import { DRAFT, FINAL } from '@/lib/app/example/example-review';

/** The newest model file, as the example's own test reads it: the one that will be served next. */
const DATA = 'lib/app/frameworks/howdoesthisland/data';
const versionOf = (file: string) =>
  (/^model-(\d+)\.(\d+)\.(\d+)\.json$/.exec(file) ?? []).slice(1).map(Number);
const NEWEST = readdirSync(DATA)
  .filter((f) => versionOf(f).length === 3)
  .sort((a, b) => {
    const [x, y] = [versionOf(a), versionOf(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  })
  .at(-1)!;
const NEWEST_VERSION = versionOf(NEWEST).join('.');
const MODEL = JSON.parse(readFileSync(`${DATA}/${NEWEST}`, 'utf8')) as Record<string, unknown>;

beforeEach(() => {
  __resetExampleCacheForTests();
  mockEnv.QUICK_SCAN_ENABLED = true;
  log.error.mockReset();
  mocks.getFramework.mockReset().mockResolvedValue({ latestVersion: NEWEST_VERSION });
  mocks.loadModel.mockReset().mockResolvedValue(MODEL);
});

describe('/example-review', () => {
  it('renders every step, in the app’s report components, all in the HTML', async () => {
    const { container } = render(await ExampleRoute());
    for (const step of ['draft', 'quick', 'review', 'report', 'rewrite']) {
      expect(container.querySelector(`[data-testid="step-${step}"]`), step).not.toBeNull();
    }
    // The draft, marked up by the quick scan and by the reviewers, and the final draft.
    expect(container.querySelector('#quick-note-1')).not.toBeNull();
    expect(container.querySelector('#review-note-1')).not.toBeNull();
    expect(container.querySelector('#final-note-1')).not.toBeNull();
    expect(container.textContent).toContain(
      'My name is Tom and I am the Business Development Manager at BrightPath Consulting.'
    );
    expect(container.textContent).toContain(FINAL.split('\n')[2]);
    // Ids are unique, though the copy appears three times.
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    // No version number on a public page.
    expect(container.textContent).not.toMatch(/\b\d+\.\d+\.\d+\b/);
    expect(metadata.alternates?.canonical).toBe('/example-review');
  });

  it('shows the engine’s scores: the draft weak, the rewrite much stronger', async () => {
    const { container } = render(await ExampleRoute());
    const overall = [...container.querySelectorAll('[data-testid="overall"]')].map((e) =>
      Number(e.textContent)
    );
    expect(overall).toHaveLength(2);
    const [before, after] = overall;
    expect(after - before).toBeGreaterThan(30);
  });

  it('shows one step at a time, moved by the tabs, the arrow keys and Next', async () => {
    const user = userEvent.setup();
    render(await ExampleRoute());
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('step-draft').parentElement).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('step-quick').parentElement).toHaveAttribute('hidden');

    await user.click(screen.getByRole('button', { name: /Next: Quick scan/ }));
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('step-quick').parentElement).not.toHaveAttribute('hidden');

    tabs[1].focus();
    await user.keyboard('{End}');
    expect(tabs[4]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[4]).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tabs[3]).toHaveAttribute('aria-selected', 'true');
  });

  it('starts on the first draft and wipes to the final one, by button or slider', async () => {
    const user = userEvent.setup();
    render(await ExampleRoute());
    await user.click(screen.getByRole('tab', { name: /The rewrite/ }));
    const slider = screen.getByLabelText(/Slide to reveal the final draft/);
    expect(slider).toHaveValue('0');
    expect(screen.getByRole('button', { name: 'First draft' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await user.click(screen.getByRole('button', { name: 'Final draft' }));
    expect(slider).toHaveValue('100');
    expect(screen.getByRole('button', { name: 'Final draft' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByTestId('step-rewrite').textContent).toContain(DRAFT.split('\n')[2]);
    // Dragging sets the wipe directly, and neither button is pressed part-way.
    fireEvent.change(slider, { target: { value: '40' } });
    expect(slider).toHaveValue('40');
    expect(screen.getByRole('button', { name: 'Final draft' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    const wipe = slider.closest('figure')!.querySelector('[style*="clip-path"]')!;
    expect(wipe.getAttribute('style')).toContain('inset(0 0 0 60%)');
    fireEvent.transitionEnd(wipe);
  });

  it('leaves no link pointing at something the page does not show', async () => {
    const { container } = render(await ExampleRoute());
    const ids = new Set([...container.querySelectorAll('[id]')].map((e) => e.id));
    const dead = [...container.querySelectorAll('a[href^="#"]')]
      .map((a) => a.getAttribute('href')!.slice(1))
      .filter((id) => !ids.has(id));
    expect(dead).toEqual([]);
  });

  it('is a 404 when no version is published', async () => {
    mocks.getFramework.mockResolvedValue({ latestVersion: null });
    await expect(ExampleRoute()).rejects.toThrow('NOT_FOUND');
  });

  it('leaves the quick-scan step out while the quick scan is switched off', async () => {
    mockEnv.QUICK_SCAN_ENABLED = false;
    const { container } = render(await ExampleRoute());
    expect(container.querySelector('[data-testid="step-quick"]')).toBeNull();
    expect(within(screen.getByRole('tablist')).getAllByRole('tab')).toHaveLength(4);
  });

  it('lists only the reviewers whose replies ran, as a report does', async () => {
    const views = await loadExampleViews();
    expect(views?.draft.method.reviewers.map((r) => [r.slot, r.status])).toEqual([
      ['judge_ethos', 'succeeded'],
      ['judge_pathos', 'succeeded'],
      ['judge_logos', 'succeeded'],
      ['judge_kairos', 'succeeded'],
    ]);
  });
});

describe('loadExampleViews', () => {
  it('builds once per version, and looks up the latest at most once a minute', async () => {
    const t0 = 1_000_000;
    const first = await loadExampleViews(t0);
    const again = await loadExampleViews(t0 + 1_000);
    expect(again).toBe(first);
    expect(mocks.getFramework).toHaveBeenCalledTimes(1);
    expect(mocks.loadModel).toHaveBeenCalledTimes(1);
    await loadExampleViews(t0 + LOOKUP_TTL_MS + 1);
    expect(mocks.getFramework).toHaveBeenCalledTimes(2);
    expect(mocks.loadModel).toHaveBeenCalledTimes(1);
  });

  it('answers null, logged once, for a version the example no longer fits', async () => {
    const model = JSON.parse(JSON.stringify(MODEL)) as Record<string, Array<{ id: string }>>;
    model.content_types = model.content_types.filter((c) => c.id !== 'sales_email');
    mocks.loadModel.mockResolvedValue(model);
    expect(await loadExampleViews(1)).toBeNull();
    expect(await loadExampleViews(2)).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
    await expect(ExampleRoute()).rejects.toThrow('NOT_FOUND');
  });

  it('logs once, and still renders, when the model refuses part of the example', async () => {
    const model = JSON.parse(JSON.stringify(MODEL)) as Record<string, Array<{ id: string }>>;
    model.dimensions = model.dimensions.filter((d) => d.id !== 'eth_goodwill');
    mocks.loadModel.mockResolvedValue(model);
    expect(await loadExampleViews(1)).not.toBeNull();
    await loadExampleViews(2);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('answers null with no framework, and retries a read that failed', async () => {
    const { FrameworkApiError } = await import('@/lib/app/frameworks/api/service');
    mocks.getFramework.mockRejectedValueOnce(new FrameworkApiError('FRAMEWORK_NOT_FOUND', 'none'));
    expect(await loadExampleViews(1)).toBeNull();
    __resetExampleCacheForTests();
    mocks.loadModel.mockRejectedValueOnce(new Error('database down'));
    await expect(loadExampleViews(1)).rejects.toThrow('database down');
    expect(await loadExampleViews(2)).not.toBeNull();
  });

  it('shares one lookup between concurrent views', async () => {
    let resolve!: (v: { latestVersion: string }) => void;
    mocks.getFramework.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const views = [loadExampleViews(1), loadExampleViews(1), loadExampleViews(1)];
    resolve({ latestVersion: NEWEST_VERSION });
    const [a, b, c] = await Promise.all(views);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(mocks.getFramework).toHaveBeenCalledTimes(1);
  });

  it('keeps the last good version when a lookup fails, and retries after the interval', async () => {
    const good = await loadExampleViews(1);
    mocks.getFramework.mockRejectedValue(new Error('database blip'));
    expect(await loadExampleViews(1 + LOOKUP_TTL_MS)).toBe(good);
    expect(await loadExampleViews(2 + LOOKUP_TTL_MS)).toBe(good);
    // One failed lookup in the interval, not one per view.
    expect(mocks.getFramework).toHaveBeenCalledTimes(2);
  });

  it('throws when the first lookup ever fails, having no good version to keep', async () => {
    mocks.getFramework.mockRejectedValue(new Error('database down'));
    await expect(loadExampleViews(1)).rejects.toThrow('database down');
  });

  it('does not keep a version whose document is not readable yet', async () => {
    mocks.loadModel.mockResolvedValueOnce(null);
    expect(await loadExampleViews(1)).toBeNull();
    expect(await loadExampleViews(2)).not.toBeNull();
    expect(mocks.loadModel).toHaveBeenCalledTimes(2);
  });
});
