/**
 * App admin-sidebar nav registrations.
 *
 * **Fork-owned scaffold** — Sunrise ships this empty and does NOT change it
 * after release, so your edits here merge cleanly on upgrade (the stable
 * contract is this file's export, not its body). Treat it like the landing
 * page: a starting point you're expected to modify.
 *
 * Auto-wired: `components/admin/admin-sidebar.tsx` calls this once at module
 * load (client runtime). Add `registerNavSection({ … })` calls. Keep this file
 * client-safe — registrar + icon imports only, no server code — and use a
 * `title` distinct from the core sections.
 *
 * Full guide + example: CUSTOMIZATION.md §4 · lib/admin-nav/registry.ts
 */
import { Coins, Scale } from 'lucide-react';
import { ADMIN_CREDITS_PATH } from '@/lib/app/credits/wire';
import { registerNavSection } from '@/lib/admin-nav/registry';

export function initAppNav(): void {
  registerNavSection({
    title: 'HowDoesThisLand',
    items: [
      {
        // t-38: platform admins only (no `tier`), as the page and its routes are.
        href: '/admin/frameworks',
        label: 'Frameworks',
        icon: Scale,
        description: 'Framework versions and their calibration runs',
      },
      {
        // t-57: platform admins only (no `tier`), as the page and its routes are.
        href: ADMIN_CREDITS_PATH,
        label: 'CopyCredits',
        icon: Coins,
        description: 'Each workspace’s credits, and granting or adjusting them',
      },
    ],
  });
}
