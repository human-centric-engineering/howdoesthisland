/**
 * Workspace settings loading skeleton. Its own, so the parent's tab skeleton
 * does not flash on a page that has no tabs.
 */
export default function WorkspaceSettingsLoading() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="space-y-2">
        <div className="bg-muted h-8 w-48 animate-pulse rounded" />
        <div className="bg-muted h-4 w-72 animate-pulse rounded" />
      </div>
      <div className="bg-muted h-40 w-full animate-pulse rounded-md" />
    </div>
  );
}
