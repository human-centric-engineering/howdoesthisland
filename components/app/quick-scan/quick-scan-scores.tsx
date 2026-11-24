/**
 * A quick scan's scores and the caveat beside them: the free quick scan's
 * answer (t-68), and a review's quick scan while its AI reviewers read
 * (t-78). The caveat is always shown with the score, never only before it,
 * so nobody reads a quick-scan score as the AI reviewers' verdict.
 */
import { QUICK_SCAN_COPY as C } from '@/components/app/quick-scan/quick-scan-copy';

export interface QuickScanScoresProps {
  overall: number | null;
  band: string | null;
  /** Each appeal's score, in the version's order. */
  appeals: Array<{ id: string; score: number }>;
  /** An appeal's name, by id. */
  nameOf: (id: string) => string;
  caveat: string;
}

export function QuickScanScores({ overall, band, appeals, nameOf, caveat }: QuickScanScoresProps) {
  return (
    <>
      {overall !== null && (
        <p className="flex items-baseline gap-3">
          <span className="text-6xl font-extrabold tabular-nums">{overall}</span>
          <span className="text-(--hd-muted)">{C.outOf}</span>
          {band && <span className="text-xl font-semibold">{band}</span>}
        </p>
      )}
      {appeals.length > 0 && (
        <ul className="grid max-w-xl gap-3">
          {appeals.map((a) => (
            <li key={a.id} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3">
              <span className="font-semibold">{nameOf(a.id)}</span>
              <span className="h-2 overflow-hidden rounded-full bg-(--hd-rule)" aria-hidden="true">
                <span
                  className="block h-full rounded-full bg-(--hd-ink)"
                  style={{ width: `${Math.max(0, Math.min(100, a.score))}%` }}
                />
              </span>
              <span className="text-right tabular-nums">{a.score}</span>
            </li>
          ))}
        </ul>
      )}
      <p
        className="max-w-[64ch] border-l-4 border-(--hd-red) pl-4 leading-relaxed"
        data-testid="quick-scan-caveat"
      >
        {caveat}
      </p>
    </>
  );
}
