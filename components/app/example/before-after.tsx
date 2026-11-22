'use client';

import { useId, useState } from 'react';

/**
 * Before and after, one over the other (t-69). It starts on the first draft;
 * drag the slider, or press a button, to wipe across to the final one. Both
 * texts are in the HTML; the reveal is a clip over the second. The scores sit
 * at opposite edges, so each stays in view whichever way the wipe stands.
 */
interface Side {
  label: string;
  text: string;
  score: number;
  band: string;
}

function Card({ side, tone }: { side: Side; tone: 'before' | 'after' }) {
  const score = (
    <p className="flex items-baseline gap-2">
      <span className="font-serif text-5xl leading-none font-bold tabular-nums">{side.score}</span>
      <span className="font-mono text-xs uppercase">{side.band}</span>
    </p>
  );
  return (
    <div
      className={`h-full border p-5 sm:p-8 ${
        tone === 'before'
          ? 'border-(--hd-rule) bg-(--hd-paper)'
          : 'border-(--hd-ink) bg-(--hd-paper) shadow-[inset_4px_0_0_0_var(--hd-logos)]'
      }`}
    >
      <div
        className={`flex items-end gap-4 ${tone === 'before' ? 'justify-start' : 'justify-end'}`}
      >
        {tone === 'before' ? (
          <>
            {score}
            <p className="hd-slug">{side.label}</p>
          </>
        ) : (
          <>
            <p className="hd-slug">{side.label}</p>
            {score}
          </>
        )}
      </div>
      <p className="mt-6 text-base leading-relaxed whitespace-pre-wrap sm:text-lg">{side.text}</p>
    </div>
  );
}

export function BeforeAfter({ before, after }: { before: Side; after: Side }) {
  const [reveal, setReveal] = useState(0);
  const [animate, setAnimate] = useState(false);
  const id = useId();

  const jump = (to: number) => {
    setAnimate(true);
    setReveal(to);
  };

  return (
    <figure className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show a draft">
        {[
          { to: 0, label: before.label },
          { to: 100, label: after.label },
        ].map((b) => (
          <button
            key={b.to}
            type="button"
            onClick={() => jump(b.to)}
            aria-pressed={reveal === b.to}
            className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
              reveal === b.to
                ? 'border-(--hd-ink) bg-(--hd-ink) text-(--hd-paper)'
                : 'border-(--hd-rule) hover:border-(--hd-ink)'
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="relative grid select-none">
        <div className="col-start-1 row-start-1" aria-hidden={reveal >= 100}>
          <Card side={before} tone="before" />
        </div>
        <div
          className={`col-start-1 row-start-1 motion-reduce:transition-none ${
            animate ? 'transition-[clip-path] duration-700 ease-in-out' : ''
          }`}
          style={{ clipPath: `inset(0 0 0 ${100 - reveal}%)` }}
          onTransitionEnd={() => setAnimate(false)}
          aria-hidden={reveal <= 0}
        >
          <Card side={after} tone="after" />
        </div>
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 col-start-1 row-start-1 w-0.5 bg-(--hd-red) motion-reduce:transition-none ${
            animate ? 'transition-[left] duration-700 ease-in-out' : ''
          } ${reveal <= 0 || reveal >= 100 ? 'opacity-0' : ''}`}
          style={{ left: `${100 - reveal}%` }}
        >
          <span className="absolute top-1/2 left-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-(--hd-red) font-mono text-sm text-white shadow">
            ⇆
          </span>
        </div>
      </div>

      <label htmlFor={id} className="grid gap-2 text-sm">
        <span className="flex justify-between font-mono text-xs text-(--hd-muted) uppercase">
          <span>{before.label}</span>
          <span>Drag to compare</span>
          <span>{after.label}</span>
        </span>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          value={reveal}
          onChange={(e) => {
            setAnimate(false);
            setReveal(Number(e.target.value));
          }}
          aria-valuetext={`${reveal}% of the ${after.label.toLowerCase()} shown`}
          className="w-full accent-(--hd-red)"
        />
        <span className="sr-only">Slide to reveal the {after.label.toLowerCase()}</span>
      </label>
      <figcaption className="text-sm text-(--hd-muted)">
        The same review, run again on the final draft: {before.score} becomes {after.score}.
      </figcaption>
    </figure>
  );
}
