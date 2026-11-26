/** Comparisons loading skeleton: the heading and the list (t-90). */
export default function ComparisonsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading comparisons">
      <div className="bg-muted h-8 w-56 animate-pulse rounded" />
      <div className="bg-muted h-64 w-full animate-pulse rounded-md" />
    </div>
  );
}
