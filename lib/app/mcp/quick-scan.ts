/**
 * `quick_scan` (t-92): `POST /api/v1/scan` as an MCP tool.
 *
 * The same `runQuickScan` the route runs, answering the route's summary (the
 * scores, the band and the caveat) rather than the full result, whose
 * offsets an assistant cannot place. No AI call, nothing stored, no credit,
 * so it needs no person behind the key. Off when the quick scan's switch is
 * off, as the route is.
 */
import { z } from 'zod';
import { runQuickScan } from '@/lib/app/assessments/api/scan';
import { contextField, textField } from '@/lib/app/assessments/api/validations';
import { QUICK_SCAN } from '@/lib/app/mcp/definitions';
import { draftShape, refusalOf } from '@/lib/app/mcp/tool-support';
import { summariseQuickScan, type QuickScanSummary } from '@/lib/app/quick-scan/summary';
import { isQuickScanEnabled } from '@/lib/app/quick-scan/switch';
import {
  BaseCapability,
  type ProvenanceRedaction,
} from '@/lib/orchestration/capabilities/base-capability';
import type { CapabilityContext, CapabilityResult } from '@/lib/orchestration/capabilities/types';

export const quickScanArgsSchema = z.strictObject({ text: textField, context: contextField });

type Args = z.infer<typeof quickScanArgsSchema>;

export class QuickScanCapability extends BaseCapability<Args, QuickScanSummary> {
  readonly slug = QUICK_SCAN.name;
  readonly functionDefinition = QUICK_SCAN;
  /** A draft is the writer's own words, which may name people. */
  readonly processesPii = true;
  protected readonly schema = quickScanArgsSchema;

  async execute(
    args: Args,
    _context: CapabilityContext
  ): Promise<CapabilityResult<QuickScanSummary>> {
    if (!isQuickScanEnabled()) {
      return this.error('The quick scan is switched off on this server.', 'QUICK_SCAN_OFF');
    }
    try {
      return this.success(summariseQuickScan(await runQuickScan(args)));
    } catch (err) {
      const refusal = refusalOf(err);
      if (!refusal) throw err;
      return this.error(refusal.message, refusal.code);
    }
  }

  redactProvenance(args: Args, result: CapabilityResult<QuickScanSummary>): ProvenanceRedaction {
    return {
      args: { ...draftShape(args), context: args.context },
      resultPreview: result.success
        ? JSON.stringify({ overall: result.data?.overall, band: result.data?.band })
        : JSON.stringify(result.error),
    };
  }
}
