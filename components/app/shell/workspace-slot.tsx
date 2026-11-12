/**
 * WorkspaceSlot — where the signed-in header shows which workspace you are in,
 * and lets you switch (t-8). The project half ("Northwind Studio / BrightPath
 * outbound") arrives with projects.
 *
 * Renders the switcher at `TENANCY_MODE=multi` only. At `single` every
 * account shares the install org, so there is nothing to switch between and
 * nothing to create.
 *
 * Placed in the signed-in header by `app/(protected)/layout.tsx`, beside the
 * nav (ledger row 6). The platform header has no slot of its own for it.
 */
import { isMultiTenant } from '@/lib/tenancy/context';
import { WorkspaceSwitcher } from '@/components/app/workspaces/workspace-switcher';

export function WorkspaceSlot(): React.ReactNode {
  if (!isMultiTenant()) return null;
  return <WorkspaceSwitcher />;
}
