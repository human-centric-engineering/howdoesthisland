/** Assess loading skeleton: the heading, the copy and the reader settings. */
export default function AssessLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="bg-muted h-8 w-64 animate-pulse rounded" />
        <div className="bg-muted h-4 w-96 max-w-full animate-pulse rounded" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="bg-muted h-96 w-full animate-pulse rounded-md" />
        <div className="bg-muted h-96 w-full animate-pulse rounded-md" />
      </div>
    </div>
  );
}
