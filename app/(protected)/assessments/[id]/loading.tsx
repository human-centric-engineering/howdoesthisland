/**
 * Report loading skeleton — shown while the page reads the assessment and its
 * model version from the API (t-29).
 */
export default function ReportLoading() {
  return (
    <div
      className="hd-sheet mx-auto max-w-5xl space-y-6"
      aria-busy="true"
      aria-label="Loading report"
    >
      <div className="bg-muted h-9 w-2/3 animate-pulse rounded" />
      <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <div className="bg-muted h-6 w-40 animate-pulse rounded" />
          <div className="bg-muted h-24 w-full animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}
