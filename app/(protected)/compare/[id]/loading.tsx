/**
 * Comparison loading skeleton — shown while the page reads the comparison and
 * its model version from the API (t-89).
 */
export default function CompareLoading() {
  return (
    <div
      className="hd-sheet mx-auto max-w-6xl space-y-6"
      aria-busy="true"
      aria-label="Loading comparison"
    >
      <div className="bg-muted h-9 w-2/3 animate-pulse rounded" />
      <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
      <div className="bg-muted h-24 w-full animate-pulse rounded" />
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-muted h-40 animate-pulse rounded" />
        ))}
      </div>
    </div>
  );
}
