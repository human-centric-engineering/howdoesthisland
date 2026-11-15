import { ChartFigure, ChartRow, Track } from '@/components/app/report/charts/chart-figure';
import { percentOf } from '@/components/app/report/charts/shares';

export interface ScoreBarRow {
  id: string;
  label: string;
  sublabel?: string;
  /** Null when the thing could not be scored: the row keeps its place, with no bar. */
  score: number | null;
  /** The mark's colour; ink when unset. */
  colour?: string;
}

const INK = 'var(--hd-ink)';

/** The unfilled track: a light step of the bar's own colour, so a row reads as one. */
const trackOf = (colour: string) => `color-mix(in srgb, ${colour} 16%, var(--hd-paper))`;

/**
 * Scores on one scale, one bar per row (t-30): the appeal scores out of 100,
 * the perspective scores out of 4.
 */
export function ScoreBars({
  title,
  description,
  rows,
  max,
  unit = '',
  testId,
}: {
  title: string;
  description?: string;
  rows: readonly ScoreBarRow[];
  max: number;
  /** Printed after the score, e.g. "/4". */
  unit?: string;
  testId?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <ChartFigure title={title} description={description} testId={testId}>
      {rows.map((r) => {
        const colour = r.colour ?? INK;
        return (
          <ChartRow
            key={r.id}
            label={r.label}
            sublabel={r.sublabel}
            value={
              r.score !== null ? (
                `${r.score}${unit}`
              ) : (
                <span className="text-(--hd-muted)">Not scored</span>
              )
            }
          >
            <Track>
              <rect x="0" y="4" width="100%" height="8" style={{ fill: trackOf(colour) }} />
              {r.score !== null && r.score > 0 ? (
                <rect
                  x="0"
                  y="4"
                  width={`${percentOf(r.score, max)}%`}
                  height="8"
                  style={{ fill: colour }}
                  data-mark="score"
                />
              ) : null}
            </Track>
          </ChartRow>
        );
      })}
    </ChartFigure>
  );
}
