/**
 * WorkspaceSlot — where the signed-in header shows which workspace and project
 * you are in ("Northwind Studio / BrightPath outbound").
 *
 * Renders nothing until `f-workspaces` fills it: there are no workspaces yet,
 * and an empty switcher would be a control with nothing behind it.
 *
 * Placed in the signed-in header by `app/(protected)/layout.tsx`, beside the
 * nav (ledger row 6). The platform header has no slot of its own for it.
 */
export function WorkspaceSlot(): React.ReactNode {
  return null;
}
