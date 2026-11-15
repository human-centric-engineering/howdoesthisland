import { ChartFigure, ChartRow, Track } from '@/components/app/report/charts/chart-figure';

export interface ScaleRow {
  id: string;
  name: string;
  /** The scale's two poles. */
  low: string;
  high: string;
  /** Where the copy sits, 0 (low) to 1 (high). */
  position: number;
  /** Where the reader expects it, 0 to 1. */
  target: number;
}

const INK = 'var(--hd-ink)';
const PAPER = 'var(--hd-paper)';

const at = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) * 100 : 50);
const figure = (v: number) => Math.round(at(v));

/**
 * A pole's short name for the end of the line. The model writes each pole as
 * "Name: what it means"; one written without a name gets no end label, and
 * the row's line under its name still carries the whole text.
 */
export function poleName(pole: string): string | null {
  const i = pole.indexOf(':');
  return i > 0 && i <= 30 ? pole.slice(0, i).trim() : null;
}

function Legend() {
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <svg width="10" height="10" aria-hidden="true" focusable="false">
          <circle cx="5" cy="5" r="4" style={{ fill: INK }} />
        </svg>
        The copy
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="14" height="14" aria-hidden="true" focusable="false">
          <circle cx="7" cy="7" r="5.5" strokeWidth="1.5" style={{ fill: PAPER, stroke: INK }} />
        </svg>
        The reader
      </span>
    </>
  );
}

/**
 * The culture scales (t-30): each a line between its two poles, with where
 * the copy sits and where the reader expects it, joined so the gap reads.
 */
export function ScalePositions({
  rows,
  testId = 'chart-culture',
}: {
  rows: readonly ScaleRow[];
  testId?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <ChartFigure
      title="Culture scales"
      description="Where the copy sits on each scale, and where this reader expects it."
      legend={<Legend />}
      testId={testId}
    >
      {rows.map((s) => {
        const copy = at(s.position);
        const reader = at(s.target);
        const lowName = poleName(s.low);
        const highName = poleName(s.high);
        return (
          <ChartRow
            key={s.id}
            label={s.name}
            sublabel={`${s.low} ↔ ${s.high}`}
            value={
              <>
                <span className="sr-only">the copy </span>
                {figure(s.position)}
                <span className="block text-xs text-(--hd-muted)">reader {figure(s.target)}</span>
              </>
            }
          >
            <Track height={18}>
              <line
                x1="0"
                x2="100%"
                y1="9"
                y2="9"
                strokeWidth="1"
                style={{ stroke: 'var(--hd-rule)' }}
              />
              <line
                x1={`${Math.min(copy, reader)}%`}
                x2={`${Math.max(copy, reader)}%`}
                y1="9"
                y2="9"
                strokeWidth="2"
                style={{ stroke: 'var(--hd-muted)' }}
                data-mark="gap"
              />
              <circle
                cx={`${reader}%`}
                cy="9"
                r="6.5"
                strokeWidth="1.5"
                style={{ fill: PAPER, stroke: INK }}
                data-mark="reader"
              />
              <circle
                cx={`${copy}%`}
                cy="9"
                r="5"
                strokeWidth="2"
                style={{ fill: INK, stroke: PAPER }}
                data-mark="copy"
              />
            </Track>
            {lowName || highName ? (
              <span
                className="mt-1 flex justify-between gap-4 font-mono text-[0.6rem] text-(--hd-muted) uppercase"
                aria-hidden="true"
              >
                <span>{lowName}</span>
                <span>{highName}</span>
              </span>
            ) : null}
          </ChartRow>
        );
      })}
    </ChartFigure>
  );
}
