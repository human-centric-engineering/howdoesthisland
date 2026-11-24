/** Home loading skeleton: the heading, the filters and the list of reviews. */
export default function HomeLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="bg-muted h-8 w-56 animate-pulse rounded" />
      <div className="flex flex-wrap gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="bg-muted h-10 w-48 animate-pulse rounded-md" />
        ))}
      </div>
      <div className="bg-muted h-64 w-full animate-pulse rounded-md" />
    </div>
  );
}
