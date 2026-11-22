// @vitest-environment happy-dom

/**
 * Tests: `/example-review`, one cold email through a review (t-69).
 *
 * The engine, the report's schemas and `buildReportView` run for real over
 * model 0.5.1; only the version lookup and the model read are stubbed.
 *
 * @see components/app/example/example-page.tsx
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
import { DRAFT, FINAL } from '@/lib/app/example/example-review';

const MODEL = JSON.parse(
  readFileSync('lib/app/frameworks/howdoesthisland/data/model-0.5.1.json', 'utf8')
) as Record<string, unknown>;

beforeEach(() => {
  mocks.getFramework.mockReset().mockResolvedValue({ latestVersion: '0.5.1' });
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
});
