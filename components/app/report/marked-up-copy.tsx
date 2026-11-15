import type { ReportView } from '@/lib/app/reports/view';

/**
 * The copy, marked up: each note's words marked in place, numbered as in the
 * notes list beside it. Each number links to the note, and each note to its
 * dimension and, where there is one, its recommendation. Plain anchors, so it
 * needs no client script and the links survive into the PDF.
 */
export function MarkedUpCopy({ copy }: { copy: ReportView['copy'] }) {
  const byNumber = new Map(copy.notes.map((n) => [n.number, n]));
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] print:block">
      <div className="text-lg leading-relaxed whitespace-pre-wrap" data-testid="copy">
        {copy.segments.map((seg, i) => {
          if (seg.notes.length === 0) return <span key={i}>{seg.text}</span>;
          const weak = seg.notes.some((n) => byNumber.get(n)?.polarity === 'weakness');
          // A note spanning several segments is numbered once, where it ends.
          const ending = seg.notes.filter((n) => copy.segments[i + 1]?.notes.includes(n) !== true);
          return (
            <mark
              key={i}
              data-notes={seg.notes.join(' ')}
              className={
                weak
                  ? 'bg-transparent text-inherit underline decoration-(--hd-red) decoration-2 underline-offset-4'
                  : 'bg-transparent text-inherit underline decoration-(--hd-logos) decoration-2 underline-offset-4'
              }
            >
              {seg.text}
              {ending.map((n) => (
                <a
                  key={n}
                  href={`#note-${n}`}
                  aria-label={`Note ${n}`}
                  className="ml-0.5 align-super font-mono text-[0.6rem] text-(--hd-muted) no-underline"
                >
                  {n}
                </a>
              ))}
            </mark>
          );
        })}
      </div>
      <ol className="grid content-start gap-4 text-sm print:mt-6" aria-label="Notes">
        {copy.notes.map((n) => (
          <li
            key={n.number}
            id={`note-${n.number}`}
            className="break-inside-avoid border-l-2 pl-3"
            style={{ borderColor: n.polarity === 'weakness' ? 'var(--hd-red)' : 'var(--hd-logos)' }}
          >
            <p className="font-mono text-[0.7rem] text-(--hd-muted) uppercase">
              {n.number} · {n.polarity === 'weakness' ? 'To fix' : 'Works'} ·{' '}
              {n.dimensionShown ? (
                <a href={`#dim-${n.dimensionId}`} className="underline">
                  {n.dimensionName}
                </a>
              ) : (
                n.dimensionName
              )}
              {n.flag ? ` · ${n.flag}` : null}
            </p>
            <p className="mt-1">{n.note}</p>
            {!n.placed ? (
              <p className="mt-1 text-(--hd-muted) italic">&ldquo;{n.quote}&rdquo;</p>
            ) : null}
            {n.recommendation !== null ? (
              <a href={`#rec-${n.recommendation}`} className="mt-1 inline-block text-xs underline">
                See recommendation {n.recommendation}
              </a>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
