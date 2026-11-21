/**
 * A review code's QR (t-59): the module grid is square with a white margin
 * for scanners, the SVG is that same code black on white, and longer links
 * give bigger codes rather than failing.
 */
import { describe, expect, it } from 'vitest';
import { qrFileName, qrModules, qrSvg } from '@/lib/app/credits/codes/qr';

const LINK = 'https://howdoesthisland.com/redeem?code=ABCDEFGHJKMN';

describe('qrModules', () => {
  it('is a square grid with a four-module white margin', () => {
    const grid = qrModules(LINK);
    const n = grid.length;
    expect(grid.every((row) => row.length === n)).toBe(true);
    for (let i = 0; i < 4; i++) {
      expect(grid[i]?.some(Boolean)).toBe(false);
      expect(grid[n - 1 - i]?.some(Boolean)).toBe(false);
      expect(grid.some((row) => row[i] || row[n - 1 - i])).toBe(false);
    }
    // The finder pattern's dark corner sits just inside the margin.
    expect(grid[4]?.[4]).toBe(true);
  });

  it('is the same for the same link, and grows for a longer one', () => {
    expect(qrModules(LINK)).toEqual(qrModules(LINK));
    expect(qrModules(`${LINK}&campaign=${'x'.repeat(200)}`).length).toBeGreaterThan(
      qrModules(LINK).length
    );
  });
});

describe('qrSvg', () => {
  it('is an SVG document, black on white', () => {
    const svg = qrSvg(LINK);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('black');
    expect(svg).toContain('white');
  });
});

describe('qrFileName', () => {
  it('names the file after the code', () => {
    expect(qrFileName('ABCDEFGHJKMN', 'png')).toBe('review-code-ABCDEFGHJKMN.png');
    expect(qrFileName('ABCDEFGHJKMN', 'svg')).toBe('review-code-ABCDEFGHJKMN.svg');
  });
});
