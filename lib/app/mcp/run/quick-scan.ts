/**
 * The work of `quick_scan` (t-92), loaded on its first call: the route's
 * `runQuickScan`, answered as the route's summary.
 */
import { runQuickScan } from '@/lib/app/assessments/api/scan';
import { refusalOf } from '@/lib/app/mcp/run/refusal';
import type { ToolOutcome } from '@/lib/app/mcp/tool-support';
import { summariseQuickScan, type QuickScanSummary } from '@/lib/app/quick-scan/summary';
import { isQuickScanEnabled } from '@/lib/app/quick-scan/switch';

export async function quickScanTool(args: {
  text: string;
  context?: Record<string, unknown>;
}): Promise<ToolOutcome<QuickScanSummary>> {
  if (!isQuickScanEnabled()) {
    return {
      refusal: {
        code: 'QUICK_SCAN_OFF',
        message: 'The quick scan is switched off on this server.',
      },
    };
  }
  try {
    return { data: summariseQuickScan(await runQuickScan(args)) };
  } catch (err) {
    const refusal = refusalOf(err);
    if (!refusal) throw err;
    return { refusal };
  }
}
