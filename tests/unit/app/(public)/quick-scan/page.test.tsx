// @vitest-environment happy-dom

/**
 * Tests: `/quick-scan`, the free quick scan for anyone (t-68).
 *
 * The route is a shim, so this imports it as Next does. The framework read
 * is stubbed with model 0.5.1; the scan request goes through a stubbed
 * `apiClient`, so what is checked is what the page sends and shows.
 *
 * @see components/app/quick-scan/quick-scan-page.tsx
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
const mockEnv = vi.hoisted((): { NODE_ENV: string; QUICK_SCAN_ENABLED: boolean | undefined } => ({
  NODE_ENV: 'test',
  QUICK_SCAN_ENABLED: true,
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const mocks = vi.hoisted(() => ({
  getFramework: vi.fn(),
  loadModel: vi.fn(),
  post: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/app/frameworks/api/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/frameworks/api/service')>()),
  getFramework: mocks.getFramework,
}));
vi.mock('@/lib/app/reports/pdf/print-source', () => ({ loadModelDocument: mocks.loadModel }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { post: mocks.post },
}));

import QuickScanRoute, { metadata } from '@/app/(public)/quick-scan/page';
import { QUICK_SCAN_CAVEAT } from '@/lib/app/quick-scan/summary';
import { APIClientError } from '@/lib/api/client';
import { FrameworkApiError } from '@/lib/app/frameworks/api/service';

const MODEL = JSON.parse(
  readFileSync('lib/app/frameworks/howdoesthisland/data/model-0.5.1.json', 'utf8')
) as Record<string, unknown>;

const SUMMARY = {
  framework: { slug: 'howdoesthisland', version: '0.5.1' },
  wordCount: 12,
  overall: 58,
  band: 'Developing',
  appeals: [
    { id: 'ethos', score: 61 },
    { id: 'pathos', score: 44 },
    { id: 'logos', score: 70 },
    { id: 'kairos', score: 52 },
  ],
  caveat: QUICK_SCAN_CAVEAT,
};

beforeEach(() => {
  mockEnv.QUICK_SCAN_ENABLED = true;
  mocks.getFramework.mockReset().mockResolvedValue({ latestVersion: '0.5.1' });
  mocks.loadModel.mockReset().mockResolvedValue(MODEL);
  mocks.post.mockReset().mockResolvedValue(SUMMARY);
});

describe('/quick-scan', () => {
  it('is a 404 with the quick-scan switch off', async () => {
    mockEnv.QUICK_SCAN_ENABLED = false;
    await expect(QuickScanRoute()).rejects.toThrow('NOT_FOUND');
  });

  it('says what the quick scan cannot do before anything is run, and has its own metadata', async () => {
    render(await QuickScanRoute());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Check your copy in seconds, free.'
    );
    expect(screen.getByText(QUICK_SCAN_CAVEAT)).toBeInTheDocument();
    expect(metadata.alternates?.canonical).toBe('/quick-scan');
    expect(String(metadata.description)).toContain('not a full review');
  });

  it('offers the version’s types of copy, general first selected', async () => {
    render(await QuickScanRoute());
    const select = screen.getByLabelText('Type of copy');
    const options = [...select.querySelectorAll('option')].map((o) => o.value);
    expect(options).toEqual((MODEL.content_types as { id: string }[]).map((t) => t.id));
    expect(select).toHaveValue('general');
  });

  it('runs signed out, and shows the scores with the caveat beside them and one way on', async () => {
    const user = userEvent.setup();
    render(await QuickScanRoute());
    await user.type(screen.getByLabelText('Your copy'), 'We cut costs by 18% in six months.');
    await user.selectOptions(screen.getByLabelText('Type of copy'), 'sales_email');
    await user.click(screen.getByRole('button', { name: 'Run the quick scan' }));

    await waitFor(() => expect(screen.getByTestId('quick-scan-result')).toBeInTheDocument());
    expect(mocks.post).toHaveBeenCalledWith('/api/v1/scan', {
      body: { text: 'We cut costs by 18% in six months.', context: { contentType: 'sales_email' } },
    });
    const result = screen.getByTestId('quick-scan-result');
    expect(result).toHaveTextContent('58');
    expect(result).toHaveTextContent('Developing');
    // Appeals named from the model, not by id.
    expect(result).toHaveTextContent('Pathos');
    expect(screen.getByTestId('quick-scan-caveat')).toHaveTextContent(QUICK_SCAN_CAVEAT);
    expect(screen.getByTestId('quick-scan-redeem')).toHaveAttribute('href', '/redeem');
    // No version number on a public page.
    expect(result).not.toHaveTextContent('0.5.1');
  });

  it('asks for copy, and sends nothing, when the box is empty', async () => {
    const user = userEvent.setup();
    render(await QuickScanRoute());
    await user.click(screen.getByRole('button', { name: 'Run the quick scan' }));
    expect(await screen.findByText('Paste some copy to scan.')).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('says so beside the button when the scan fails, and shows no score', async () => {
    mocks.post.mockRejectedValue(
      new APIClientError('Too many requests', 'RATE_LIMIT_EXCEEDED', 429)
    );
    const user = userEvent.setup();
    render(await QuickScanRoute());
    await user.type(screen.getByLabelText('Your copy'), 'Some copy.');
    await user.click(screen.getByRole('button', { name: 'Run the quick scan' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByTestId('quick-scan-result')).toBeNull();
  });

  it('still runs, naming scores by id, when the names cannot be read', async () => {
    mocks.loadModel.mockResolvedValue(null);
    render(await QuickScanRoute());
    expect(screen.queryByLabelText('Type of copy')).toBeNull();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Your copy'), 'Some copy.');
    await user.click(screen.getByRole('button', { name: 'Run the quick scan' }));
    await waitFor(() =>
      expect(screen.getByTestId('quick-scan-result')).toHaveTextContent('pathos')
    );
    expect(mocks.post).toHaveBeenCalledWith('/api/v1/scan', { body: { text: 'Some copy.' } });
  });

  it('reads no model when there is no latest version, and offers no types', async () => {
    mocks.getFramework.mockResolvedValue({ latestVersion: null });
    render(await QuickScanRoute());
    expect(mocks.loadModel).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Type of copy')).toBeNull();
  });

  it('still renders when the framework is not found, and logs only a failure it did not expect', async () => {
    mocks.getFramework.mockRejectedValue(new FrameworkApiError('FRAMEWORK_NOT_FOUND', 'none'));
    render(await QuickScanRoute());
    expect(screen.getByRole('button', { name: 'Run the quick scan' })).toBeInTheDocument();
    expect(mocks.logError).not.toHaveBeenCalled();

    mocks.getFramework.mockRejectedValue(new Error('database down'));
    render(await QuickScanRoute());
    expect(mocks.logError).toHaveBeenCalledWith(
      'Quick scan page: could not read the names for its form',
      expect.any(Error)
    );
  });
});
