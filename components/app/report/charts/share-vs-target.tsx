import { ChartFigure, ChartRow, Track } from '@/components/app/report/charts/chart-figure';
import { percentOf } from '@/components/app/report/charts/shares';

export interface ShareRow {
  id: string;
  label: string;
  sublabel?: string;
  /** This copy's share, in percent. */
  share: number;
  /** The share the target mix asks for, in percent; null when there is none. */
  target: number | null;
  colour?: string;
}

const INK = 'var(--hd-ink)';
const trackOf = (colour: string) => `color-mix(in srgb, ${colour} 16%, var(--hd-paper))`;

/** The key: the bar is this copy, the upright line the target. */
function Legend() {
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <svg width="14" height="8" aria-hidden="true" focusable="false">
          <rect width="14" height="8" style={{ fill: 'var(--hd-muted)' }} />
        </svg>
        This copy
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="4" height="14" aria-hidden="true" focusable="false">
          <rect width="2" height="14" x="1" style={{ fill: INK }} />
        </svg>
        Target
      </span>
    </>
  );
}

/**
 * Each part's share of this copy against the share the target mix asks for
 * (t-30): the four appeals against the effective weights behind the balance
 * index, and the duty profile against its target. A bar per part on one
 * 0–100% scale, with the target as an upright line across it, so a reader
 * sees each gap at its own row rather than comparing two stacked wholes.
 */
export function ShareVsTarget({
  title,
  description,
  rows,
  testId,
}: {
  title: string;
  description?: string;
  rows: readonly ShareRow[];
  testId?: string;
}) {
  if (rows.length === 0) return null;
  // One scale for every row: the largest share or target, so small mixes are not squashed.
  const max = Math.max(
    1,
    ...rows.map((r) => (Number.isFinite(r.share) ? r.share : 0)),
    ...rows.map((r) => r.target ?? 0)
  );
  const scale = Math.min(100, Math.ceil(max / 10) * 10);
  const anyTarget = rows.some((r) => r.target !== null);
  return (
    <ChartFigure
      title={title}
      description={description}
      legend={anyTarget ? <Legend /> : undefined}
      testId={testId}
    >
      {rows.map((r) => {
        const colour = r.colour ?? INK;
        const at = r.target !== null ? percentOf(r.target, scale) : null;
        return (
          <ChartRow
            key={r.id}
            label={r.label}
            sublabel={r.sublabel}
            value={
              <>
                <span className="sr-only">this copy </span>
                {Math.round(r.share)}%
                <span className="block text-xs text-(--hd-muted)">
                  {r.target !== null ? `target ${Math.round(r.target)}%` : 'no target'}
                </span>
              </>
            }
          >
            <Track height={18}>
              <rect x="0" y="5" width="100%" height="8" style={{ fill: trackOf(colour) }} />
              {r.share > 0 ? (
                <rect
                  x="0"
                  y="5"
                  width={`${percentOf(r.share, scale)}%`}
                  height="8"
                  style={{ fill: colour }}
                  data-mark="share"
                />
              ) : null}
              {at !== null ? (
                <g data-mark="target">
                  {/* A paper ring first, so the line stays visible over the bar. */}
                  <line
                    x1={`${at}%`}
                    x2={`${at}%`}
                    y1="0"
                    y2="18"
                    strokeWidth="4"
                    style={{ stroke: 'var(--hd-paper)' }}
                  />
                  <line
                    x1={`${at}%`}
                    x2={`${at}%`}
                    y1="0"
                    y2="18"
                    strokeWidth="2"
                    style={{ stroke: INK }}
                  />
                </g>
              ) : null}
            </Track>
          </ChartRow>
        );
      })}
    </ChartFigure>
  );
}
