/** Usage loading skeleton: the heading, the budget and the totals. */
export default function UsageLoading() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="space-y-2">
        <div className="bg-muted h-8 w-48 animate-pulse rounded" />
        <div className="bg-muted h-4 w-96 max-w-full animate-pulse rounded" />
      </div>
      <div className="bg-muted h-32 w-full animate-pulse rounded-md" />
      <div className="bg-muted h-24 w-full animate-pulse rounded-md" />
      <div className="bg-muted h-40 w-full animate-pulse rounded-md" />
    </div>
  );
}
