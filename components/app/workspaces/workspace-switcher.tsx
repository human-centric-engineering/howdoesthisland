'use client';

/**
 * The workspace switcher in the signed-in header (t-8).
 *
 * Lists the caller's workspaces from core's `GET /api/v1/orgs` and switches
 * the active one with core's `POST /api/v1/orgs/switch`, then refreshes the
 * page so every server component re-reads in the new workspace. From here a
 * person can also open the workspace's settings or make a new workspace,
 * which it switches into.
 *
 * Shows nothing until the list has loaded, and nothing if it cannot be read:
 * a header control that fails to load should not take the page with it.
 * A suspended workspace is listed but cannot be picked, as the switch would
 * refuse it.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, Check, ChevronsUpDown, Plus, Settings } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { API } from '@/lib/api/endpoints';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SaveError } from '@/components/forms/form-error';
import { CreateWorkspaceDialog } from '@/components/app/workspaces/create-workspace-dialog';
import { workspaceListSchema, type WorkspaceList } from '@/components/app/workspaces/schemas';

/** Where a workspace's members and invitations are managed. */
export const WORKSPACE_SETTINGS_HREF = '/settings/workspace';

export function WorkspaceSwitcher() {
  const router = useRouter();
  const [list, setList] = useState<WorkspaceList | null>(null);
  const [switching, setSwitching] = useState(false);
  const [creating, setCreating] = useState(false);
  const save = useSaveFailure({
    fallback: 'Could not switch workspace. Try again in a moment.',
    fields: NO_SERVER_FIELDS,
  });

  const load = useCallback(async () => {
    try {
      const parsed = workspaceListSchema.safeParse(await apiClient.get<unknown>(API.ORGS.LIST));
      setList(parsed.success ? parsed.data : null);
    } catch {
      setList(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const switchTo = async (orgId: string) => {
    save.clear();
    setSwitching(true);
    try {
      await apiClient.post<unknown>(API.ORGS.SWITCH, { body: { orgId } });
      router.refresh();
    } catch (err) {
      save.report(err);
    } finally {
      // Reloaded either way: after a create whose switch failed, the new
      // workspace must still appear so it can be picked rather than remade.
      await load();
      setSwitching(false);
    }
  };

  const afterCreate = async (workspace: { id: string } | null) => {
    if (workspace) await switchTo(workspace.id);
    else await load();
  };

  if (!list) return null;
  const active = list.orgs.find((org) => org.active);

  return (
    <div className="flex items-center gap-2">
      {/* Opening the menu is the next attempt, so an old failure clears;
          otherwise it would sit in the header on every page. */}
      <DropdownMenu onOpenChange={(open) => open && save.clear()}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="max-w-[16rem] gap-2"
            disabled={switching}
            aria-label={`Workspace: ${active?.name ?? 'none chosen'}. Switch workspace`}
          >
            <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{active?.name ?? 'Choose a workspace'}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {list.orgs.map((org) => {
            const suspended = org.status !== 'ACTIVE';
            return (
              <DropdownMenuItem
                key={org.id}
                // The current one stays enabled so it reads as chosen, not as
                // unavailable; picking it again just closes the menu.
                disabled={suspended}
                onSelect={() => {
                  if (!org.active) void switchTo(org.id);
                }}
                className="gap-2"
              >
                <Check
                  className={`h-4 w-4 shrink-0 ${org.active ? 'opacity-100' : 'opacity-0'}`}
                  aria-hidden="true"
                />
                <span className="truncate">{org.name}</span>
                {org.active && <span className="sr-only">(current)</span>}
                {suspended && (
                  <span className="text-muted-foreground ml-auto text-xs">suspended</span>
                )}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          {active && (
            <DropdownMenuItem asChild className="gap-2">
              <Link href={WORKSPACE_SETTINGS_HREF}>
                <Settings className="h-4 w-4" aria-hidden="true" />
                Workspace settings
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setCreating(true)} className="gap-2">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New workspace…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SaveError failure={save.failure} />
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} onCreated={afterCreate} />
    </div>
  );
}
