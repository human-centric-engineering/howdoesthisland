'use client';

/**
 * One free review code's QR (t-59): drawn from its redeem link, with the link
 * to copy and the QR to download as SVG or PNG for printing.
 *
 * Drawn as React SVG from the module grid, not injected markup, and the PNG
 * is painted onto a canvas from the same grid, so nothing is fetched and the
 * page's CSP is not involved. Black on white in either theme: a QR printed or
 * scanned from a dark screen must still read.
 */

import { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { formatCode } from '@/lib/app/credits/codes/generate';
import { qrFileName, qrModules, qrSvg } from '@/lib/app/credits/codes/qr';
import type { ReviewCodeView } from '@/lib/app/credits/codes/wire';

/** Pixels per module in the PNG: a 33-module code is about 1,000px, sharp at card size. */
const PNG_SCALE = 24;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  // In the document, and the URL kept until the click has been handled:
  // Safari and older Firefox drop a download from a detached link, or from a
  // URL revoked in the same tick.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** One path of every dark module, so the SVG is one element, not hundreds. */
function darkPath(modules: boolean[][]): string {
  let d = '';
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    })
  );
  return d;
}

export function CodeQr({ code }: { code: ReviewCodeView }) {
  const modules = useMemo(() => qrModules(code.link), [code.link]);
  const [copied, setCopied] = useState(false);
  const size = modules.length;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(code.link);
      setCopied(true);
    } catch {
      // No clipboard (an insecure origin, or refused): the link is on the page to select.
      setCopied(false);
    }
  };

  const downloadSvg = () =>
    download(new Blob([qrSvg(code.link)], { type: 'image/svg+xml' }), qrFileName(code.code, 'svg'));

  const downloadPng = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size * PNG_SCALE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    modules.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) ctx.fillRect(x * PNG_SCALE, y * PNG_SCALE, PNG_SCALE, PNG_SCALE);
      })
    );
    canvas.toBlob((blob) => {
      if (blob) download(blob, qrFileName(code.code, 'png'));
    }, 'image/png');
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <svg
        role="img"
        aria-label={`QR code for ${formatCode(code.code)}`}
        viewBox={`0 0 ${size} ${size}`}
        className="h-40 w-40 shrink-0 rounded border"
        shapeRendering="crispEdges"
      >
        <rect width={size} height={size} fill="#fff" />
        <path d={darkPath(modules)} fill="#000" />
      </svg>
      <div className="min-w-0 space-y-3 text-sm">
        <p>
          <span className="text-muted-foreground block text-xs">Link</span>
          <span className="font-mono break-all">{code.link}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void copyLink()}>
            {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={downloadSvg}>
            <Download className="mr-1 h-4 w-4" />
            SVG
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={downloadPng}>
            <Download className="mr-1 h-4 w-4" />
            PNG
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          SVG prints sharp at any size. PNG is about {size * PNG_SCALE}px square.
        </p>
      </div>
    </div>
  );
}
