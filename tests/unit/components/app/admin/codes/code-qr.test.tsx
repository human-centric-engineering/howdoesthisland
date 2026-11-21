// @vitest-environment happy-dom

/**
 * Tests: one review code's QR (t-59) — drawn from its link's module grid,
 * the link copied, and the QR downloaded as SVG and PNG under the code's name.
 *
 * @see components/app/admin/codes/code-qr.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CodeQr } from '@/components/app/admin/codes/code-qr';
import { qrModules } from '@/lib/app/credits/codes/qr';
import type { ReviewCodeView } from '@/lib/app/credits/codes/wire';

const CODE: ReviewCodeView = {
  id: 'cmcode0000000000000000001',
  code: 'ABCDEFGHJKMN',
  link: 'https://app.test/redeem?code=ABCDEFGHJKMN',
  campaign: 'Spring stand card',
  creditsPerRedemption: 300,
  maxRedemptions: 25,
  redemptionsUsed: 0,
  redemptionsLeft: 25,
  status: 'active',
  expiresAt: '2027-02-19T23:59:59.999Z',
  revokedAt: null,
  createdAt: '2026-11-21T09:00:00.000Z',
};

/** The file names the page downloaded, in order. */
let downloads: string[];
let blobs: Blob[];

beforeEach(() => {
  downloads = [];
  blobs = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    downloads.push(this.download);
  });
});

afterEach(() => vi.restoreAllMocks());

describe('CodeQr', () => {
  it('draws the QR of the code’s link, one square per dark module, and shows the link', () => {
    const { container } = render(<CodeQr code={CODE} />);
    const svg = screen.getByRole('img', { name: 'QR code for ABCD-EFGH-JKMN' });
    const grid = qrModules(CODE.link);
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${grid.length} ${grid.length}`);
    const dark = grid.flat().filter(Boolean).length;
    const path = container.querySelector('path')?.getAttribute('d') ?? '';
    expect(path.match(/M/g)).toHaveLength(dark);
    expect(screen.getByText(CODE.link)).toBeInTheDocument();
  });

  it('copies the link', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<CodeQr code={CODE} />);
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(CODE.link);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('downloads the QR as an SVG named for the code', async () => {
    const user = userEvent.setup();
    render(<CodeQr code={CODE} />);
    await user.click(screen.getByRole('button', { name: 'SVG' }));
    expect(downloads).toEqual(['review-code-ABCDEFGHJKMN.svg']);
    expect(blobs[0]?.type).toBe('image/svg+xml');
  });

  it('paints the PNG from the same grid and downloads it named for the code', async () => {
    const user = userEvent.setup();
    const fillRect = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillRect,
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) =>
      done(new Blob(['png'], { type: 'image/png' }))
    );
    render(<CodeQr code={CODE} />);
    await user.click(screen.getByRole('button', { name: 'PNG' }));
    await waitFor(() => expect(downloads).toEqual(['review-code-ABCDEFGHJKMN.png']));
    // The white ground, then one square per dark module.
    expect(fillRect).toHaveBeenCalledTimes(1 + qrModules(CODE.link).flat().filter(Boolean).length);
  });
});
