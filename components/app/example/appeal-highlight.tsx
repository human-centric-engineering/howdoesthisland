'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The worked example's appeal scores, made to point (t-69): hover, focus or
 * tap an appeal and its notes light up in its colour, in the copy and in the
 * notes beside it, while the rest step back. Tapping pins it, so it works on
 * a touch screen; Escape or a second tap lets go.
 *
 * The copy and notes are the report's own server-rendered `MarkedUpCopy`,
 * passed as children; this only styles what it finds there, by the note
 * numbers it carries (`data-notes` on the marks, `{prefix}note-N` on the
 * notes). Which appeal each note belongs to is worked out on the server.
 */
export interface AppealRow {
  id: string;
  name: string;
  score: number;
  colour: string;
}

const tint = (colour: string, pct: number) => `color-mix(in srgb, ${colour} ${pct}%, transparent)`;

export function AppealHighlight({
  appeals,
  noteAppeal,
  prefix,
  aside,
  children,
}: {
  appeals: AppealRow[];
  /** Note number → the appeal (or reviewer group) its dimension belongs to. */
  noteAppeal: Record<number, string>;
  /** The id prefix the copy's notes carry. */
  prefix: string;
  /** Shown above the appeal rows: the overall score. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const chosen = hovered ?? pinned;
  // An appeal with no notes leaves the copy as it is, rather than dimming all of it.
  const active = chosen !== null && Object.values(noteAppeal).includes(chosen) ? chosen : null;
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const colour = appeals.find((a) => a.id === active)?.colour ?? null;
    const inActive = (numbers: number[]) => numbers.some((n) => noteAppeal[n] === active);

    for (const mark of el.querySelectorAll<HTMLElement>('mark[data-notes]')) {
      const numbers = (mark.dataset.notes ?? '').split(' ').map(Number);
      const on = active !== null && inActive(numbers);
      mark.style.backgroundColor = on && colour ? tint(colour, 22) : '';
      mark.style.textDecorationColor = on && colour ? colour : '';
      mark.style.opacity = active !== null && !on ? '0.4' : '';
      mark.style.transition = 'background-color 200ms, opacity 200ms';
      if (active === null) delete mark.dataset.highlight;
      else mark.dataset.highlight = on ? 'on' : 'off';
    }
    for (const note of el.querySelectorAll<HTMLElement>(`li[id^="${prefix}note-"]`)) {
      const n = Number(note.id.slice(`${prefix}note-`.length));
      const on = active !== null && noteAppeal[n] === active;
      note.style.borderColor = on && colour ? colour : '';
      note.style.backgroundColor = on && colour ? tint(colour, 12) : '';
      note.style.opacity = active !== null && !on ? '0.35' : '';
      note.style.transition = 'background-color 200ms, opacity 200ms';
      if (active === null) delete note.dataset.highlight;
      else note.dataset.highlight = on ? 'on' : 'off';
    }
  }, [active, appeals, noteAppeal, prefix]);

  // Escape lets go of a pinned appeal.
  useEffect(() => {
    if (pinned === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinned(null);
        setHovered(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pinned]);

  const count = (id: string) => Object.values(noteAppeal).filter((a) => a === id).length;

  return (
    <div ref={root} className="grid gap-10 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="grid content-start gap-8">
        {aside}
        <div>
          <p className="font-mono text-xs tracking-wide text-(--hd-muted) uppercase">
            Appeal scores
          </p>
          <p className="mt-1 text-sm text-(--hd-muted)">Point at one to see its notes.</p>
          <ul className="mt-4 grid gap-2" aria-label="Appeal scores">
            {appeals.map((a) => {
              const selected = chosen === a.id;
              const notes = count(a.id);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    aria-pressed={pinned === a.id}
                    aria-label={`${a.name}: ${a.score} out of 100, ${notes} ${notes === 1 ? 'note' : 'notes'}. Highlight them.`}
                    onMouseEnter={() => setHovered(a.id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(a.id)}
                    onBlur={() => setHovered(null)}
                    onClick={() => setPinned((p) => (p === a.id ? null : a.id))}
                    className="grid w-full gap-1.5 rounded-md px-2 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-(--hd-ink) focus-visible:outline-none"
                    style={{ backgroundColor: selected ? tint(a.colour, 12) : undefined }}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span
                        className="font-semibold"
                        style={{ color: selected ? a.colour : undefined }}
                      >
                        {a.name}
                      </span>
                      <span className="font-mono text-sm tabular-nums">{a.score}</span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="block h-2 overflow-hidden rounded-full"
                      style={{ backgroundColor: tint(a.colour, 18) }}
                    >
                      <span
                        className="block h-full rounded-full transition-[width] duration-500"
                        style={{
                          width: `${Math.max(0, Math.min(100, a.score))}%`,
                          backgroundColor: a.colour,
                        }}
                      />
                    </span>
                    <span className="text-xs text-(--hd-muted)">
                      {notes} {notes === 1 ? 'note' : 'notes'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}
