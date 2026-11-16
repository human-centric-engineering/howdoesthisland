// @vitest-environment happy-dom

/**
 * /r/[token] — a report opened by its share link (t-32). The page asks
 * `readSharedReport` (tested on its own, with the tenant entry) what the token
 * opens, and renders the `shared` variant from exactly that. Anything the link
 * does not open is the not-found page.
 *
 * Real: the loader, its parsers and the report. Replaced: the share service.
 *
 * @see app/(public)/r/[token]/page.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { sharedAssessmentSchema } from '@/lib/app/api/registry';
import { apiAssessment, modelDocument } from '@/tests/unit/lib/app/reports/fixtures';

const h = vi.hoisted(() => ({
  readSharedReport: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));
vi.mock('@/lib/app/reports/share/service', () => ({ readSharedReport: h.readSharedReport }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import SharedReportPage, { metadata } from '@/app/(public)/r/[token]/page';

const params = Promise.resolve({ token: 'the-token' });

/** What a link serves: the shared fields only, as the service builds them. */
function opened(model: Record<string, unknown> | null = modelDocument(true)) {
  return {
    ok: true,
    shareId: 'share-1',
    report: {
      assessment: sharedAssessmentSchema.parse(apiAssessment()),
      model,
      expiresAt: new Date('2026-12-16T09:00:00.000Z'),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/r/[token]', () => {
  it('is kept out of search engines, and sends no referrer on', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe('no-referrer');
  });

  it('renders the shared variant of what the token opens', async () => {
    h.readSharedReport.mockResolvedValue(opened());
    const { container, getByRole } = render(await SharedReportPage({ params }));

    expect(h.readSharedReport).toHaveBeenCalledWith('the-token');
    expect(container.querySelector('article')?.getAttribute('data-variant')).toBe('shared');
    expect(getByRole('heading', { level: 1 }).textContent).toBe('Q3 board briefing');
  });

  it('shows no cost, since a link carries none', async () => {
    h.readSharedReport.mockResolvedValue(opened());
    const { container } = render(await SharedReportPage({ params }));
    // The copy itself talks about costs, so look for the method's line.
    expect(container.textContent).not.toMatch(/Cost of this/);
  });

  it.each(['malformed', 'missing', 'org', 'closed', 'no-report'])(
    'is not found when the link is refused as %s',
    async (refused) => {
      h.readSharedReport.mockResolvedValue({ ok: false, refused });
      await expect(SharedReportPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
    }
  );

  it("says the report can't be shown when the model it ran on is gone", async () => {
    h.readSharedReport.mockResolvedValue(opened(null));
    const { getByRole } = render(await SharedReportPage({ params }));
    expect(getByRole('heading', { level: 1 }).textContent).toBe("This report can't be shown");
  });

  it('lets any other failure through', async () => {
    h.readSharedReport.mockRejectedValue(new Error('database down'));
    await expect(SharedReportPage({ params })).rejects.toThrow('database down');
  });
});
