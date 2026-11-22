'use client';

import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/**
 * The worked example's steps (t-69): tabs along the top, one panel at a
 * time, Back and Next below. Every panel is rendered on the server and kept
 * in the HTML (hidden, not removed), so the whole walk-through is there for
 * a reader without script and for a search engine. Arrow keys, Home and End
 * move between the steps, as in any tab list.
 */
export interface Step {
  id: string;
  label: string;
}

export function ReviewSteps({ steps, children }: { steps: Step[]; children: ReactNode[] }) {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const top = useRef<HTMLDivElement | null>(null);
  const base = useId();

  const go = useCallback(
    (i: number, fromTabs = false) => {
      const next = Math.max(0, Math.min(steps.length - 1, i));
      setActive(next);
      const tab = tabs.current[next];
      if (!fromTabs) return;
      tab?.focus();
      // On a narrow screen the tab row scrolls: keep the chosen step in view.
      // Not from Back and Next, which scroll the page to the steps instead.
      tab?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    },
    [steps.length]
  );

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: active + 1,
      ArrowLeft: active - 1,
      Home: 0,
      End: steps.length - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      go(moves[e.key], true);
    }
  };

  const step = (delta: number) => {
    go(active + delta);
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div ref={top} className="scroll-mt-20">
      <div className="relative">
        <div
          aria-hidden="true"
          className="absolute top-[1.15rem] right-0 left-0 hidden h-px bg-(--hd-rule) sm:block"
        />
        <div
          aria-hidden="true"
          className="absolute top-[1.15rem] left-0 hidden h-px bg-(--hd-red) transition-[width] duration-500 ease-out sm:block"
          style={{ width: `${(active / Math.max(1, steps.length - 1)) * 100}%` }}
        />
        <div
          role="tablist"
          aria-label="The review, step by step"
          className="relative flex gap-2 overflow-x-auto pb-2 sm:justify-between sm:overflow-visible"
        >
          {steps.map((s, i) => {
            const selected = i === active;
            const done = i < active;
            return (
              <button
                key={s.id}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                role="tab"
                id={`${base}-tab-${s.id}`}
                aria-selected={selected}
                aria-controls={`${base}-panel-${s.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => go(i, true)}
                onKeyDown={onKey}
                className="group flex shrink-0 flex-col items-center gap-2 px-1 text-center focus-visible:outline-none"
              >
                <span
                  className={`grid h-9 w-9 place-items-center rounded-full border font-mono text-sm tabular-nums transition-colors duration-300 group-focus-visible:ring-2 group-focus-visible:ring-(--hd-ink) group-focus-visible:ring-offset-2 ${
                    selected
                      ? 'border-(--hd-red) bg-(--hd-red) text-white'
                      : done
                        ? 'border-(--hd-red) bg-(--hd-paper) text-(--hd-red)'
                        : 'border-(--hd-rule) bg-(--hd-paper) text-(--hd-muted)'
                  }`}
                >
                  {i + 1}
                </span>
                <span
                  className={`text-xs font-semibold tracking-wide uppercase sm:text-sm ${
                    selected ? 'text-(--hd-ink)' : 'text-(--hd-muted)'
                  }`}
                >
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {children.map((panel, i) => (
        <div
          key={steps[i].id}
          role="tabpanel"
          id={`${base}-panel-${steps[i].id}`}
          aria-labelledby={`${base}-tab-${steps[i].id}`}
          hidden={i !== active}
          tabIndex={0}
          className="animate-in fade-in slide-in-from-bottom-2 mt-8 duration-500 focus-visible:outline-none"
        >
          {panel}
        </div>
      ))}

      <div className="mt-10 flex items-center justify-between gap-4 border-t border-(--hd-rule) pt-6">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={active === 0}
          className="inline-flex min-h-11 items-center rounded-md px-4 font-semibold disabled:opacity-30"
        >
          ← Back
        </button>
        <p className="font-mono text-sm text-(--hd-muted) tabular-nums" aria-live="polite">
          {active + 1} / {steps.length}
        </p>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={active === steps.length - 1}
          className="inline-flex min-h-11 items-center rounded-md bg-(--hd-ink) px-5 font-semibold text-(--hd-paper) disabled:opacity-30"
        >
          {active === steps.length - 1 ? 'Done' : `Next: ${steps[active + 1]?.label ?? ''} →`}
        </button>
      </div>
    </div>
  );
}
