import { useId, type ReactNode } from 'react';

/**
 * The frame every report chart shares (t-30): a captioned figure holding a
 * list of rows, one per thing measured.
 *
 * A chart's values are its visible text, beside each mark: the SVG is
 * decoration over that text and is hidden from assistive technology, so a
 * screen reader reads each row as name, then figure. That also carries the
 * values onto paper and into forced-colors mode, where a fill can fail.
 */
export function ChartFigure({
  title,
  description,
  legend,
  children,
  testId,
}: {
  title: string;
  /** One sentence on how to read it. */
  description?: string;
  /** A key for marks the rows' labels do not name. */
  legend?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  // Named by its title alone: the caption's description is read as its text.
  const titleId = useId();
  return (
    <figure
      className="@container break-inside-avoid"
      aria-labelledby={titleId}
      data-testid={testId}
    >
      <figcaption>
        <span id={titleId} className="block font-mono text-xs text-(--hd-muted) uppercase">
          {title}
        </span>
        {description ? (
          <span className="mt-1 block text-sm text-(--hd-muted)">{description}</span>
        ) : null}
      </figcaption>
      {legend ? (
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[0.65rem] text-(--hd-muted) uppercase">
          {legend}
        </div>
      ) : null}
      <ul className="mt-3 grid gap-3">{children}</ul>
    </figure>
  );
}

/**
 * One row: the name (and a line under it), the mark, and the figure. Wide,
 * they sit in three aligned columns so the marks share one scale; narrow,
 * the mark drops under the name and the figure stays beside it. "Wide" is
 * the chart's own width (a container query), since a chart can sit in half
 * of a section.
 */
export function ChartRow({
  label,
  sublabel,
  value,
  children,
}: {
  label: ReactNode;
  sublabel?: ReactNode;
  value: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 @sm:grid-cols-[8rem_minmax(0,1fr)_6.5rem] @2xl:grid-cols-[11rem_minmax(0,1fr)_6.5rem]">
      <span className="min-w-0">
        <span className="font-semibold">{label}</span>
        {sublabel ? <span className="block text-xs text-(--hd-muted)">{sublabel}</span> : null}
      </span>
      <span className="order-last col-span-2 @sm:order-none @sm:col-span-1">{children}</span>
      <span className="text-right font-mono text-sm whitespace-nowrap">{value}</span>
    </li>
  );
}

/** The SVG a row's marks are drawn in: full width, coordinates in percent. */
export function Track({ height = 16, children }: { height?: number; children: ReactNode }) {
  return (
    <svg
      width="100%"
      height={height}
      aria-hidden="true"
      focusable="false"
      className="block overflow-visible"
    >
      {children}
    </svg>
  );
}
