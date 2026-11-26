/**
 * App capability (agent tool) registrations.
 *
 * **Fork-owned scaffold** — Sunrise ships this empty and does NOT change it
 * after release, so your edits here merge cleanly on upgrade (the stable
 * contract is this file's export, not its body). Treat it like the landing
 * page: a starting point you're expected to modify.
 *
 * Auto-wired: `registerBuiltInCapabilities()` calls this once before the first
 * agent dispatch (server route-handler runtime). Add
 * `registerAppCapability(new YourTool())` calls (your tools extend
 * `BaseCapability`).
 *
 * Full guide + example: CUSTOMIZATION.md §4 · .context/orchestration/capabilities.md
 */
import { registerAppCapability } from '@/lib/orchestration/capabilities';
import { AssessDraftCapability } from '@/lib/app/mcp/assess-draft';
import { GetAssessmentCapability } from '@/lib/app/mcp/get-assessment';
import { QuickScanCapability } from '@/lib/app/mcp/quick-scan';

export function initAppCapabilities(): void {
  // HowDoesThisLand as MCP tools (t-92): `lib/app/mcp/`, `.context/app/mcp.md`.
  registerAppCapability(new QuickScanCapability());
  registerAppCapability(new AssessDraftCapability());
  registerAppCapability(new GetAssessmentCapability());
}
