/** Projects loading skeleton: the heading and the list. */
export default function ProjectsLoading() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="space-y-2">
        <div className="bg-muted h-8 w-48 animate-pulse rounded" />
        <div className="bg-muted h-4 w-96 max-w-full animate-pulse rounded" />
      </div>
      <div className="bg-muted h-64 w-full animate-pulse rounded-md" />
    </div>
  );
}
