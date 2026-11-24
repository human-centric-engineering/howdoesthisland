'use client';

/**
 * A running review's progress, from `GET /api/v1/assessments/{id}/events`
 * (t-78): its state, its quick scan and each AI reviewer as it lands.
 *
 * The stream is the browser's `EventSource`, which reconnects by itself
 * whenever a stream ends, so this closes it on every event that ends one:
 *
 * - `assessment_done` — final: closed, and `onDone` is called once.
 * - `assessment_gone` — deleted: closed.
 * - `assessment_timeout` — still going after the server's bound: closed, and
 *   opened again at once. A stream opened late replays the reviewers that
 *   have landed, which replace what is held by slot, so nothing doubles.
 *
 * A failure the browser cannot recover from (the server's own error frame,
 * or a stream it gave up on) is retried {@link MAX_RETRIES} times, a little
 * later each time, then reported as `lost`; `reconnect()` starts again. One it
 * is recovering from itself shows as `reconnecting` until the stream opens.
 */
import { useEffect, useEffectEvent, useReducer, useState } from 'react';
import { logger } from '@/lib/logging';
import {
  assessmentEventsEndpoint,
  REVIEW_EVENT_TYPES,
  reviewEventSchema,
  type EarlyQuickScanWire,
  type JudgeRunWire,
  type ReviewEvent,
  type ReviewState,
} from '@/components/app/workbench/schemas';

/** Retries of a stream that failed, before it is reported lost. */
export const MAX_RETRIES = 3;
/** The wait before the first retry; each later one waits as many times longer. */
export const RETRY_MS = 2_000;

export type Connection = 'live' | 'reconnecting' | 'lost';

export interface ReviewProgress {
  status: ReviewState;
  quickScan: EarlyQuickScanWire | null;
  /** Each AI reviewer that has landed, by slot. */
  runs: Record<string, JudgeRunWire>;
  connection: Connection;
  /** Why the stream ended for good: the review is final, or deleted. */
  ended: 'done' | 'gone' | null;
}

export interface InitialProgress {
  status: ReviewState;
  quickScan: EarlyQuickScanWire | null;
  runs: JudgeRunWire[];
}

type Action =
  { kind: 'event'; event: ReviewEvent } | { kind: 'connection'; connection: Connection };

function reduce(state: ReviewProgress, action: Action): ReviewProgress {
  if (action.kind === 'connection') {
    return state.connection === action.connection
      ? state
      : { ...state, connection: action.connection };
  }
  const { event } = action;
  const live = { ...state, connection: 'live' as const };
  switch (event.type) {
    case 'assessment_status':
      return { ...live, status: event.status };
    case 'assessment_quick_scan':
      return {
        ...live,
        quickScan: { overall: event.overall, band: event.band, result: event.result },
      };
    case 'assessment_judge':
      return {
        ...live,
        runs: {
          ...state.runs,
          [event.judge]: { judge: event.judge, status: event.status, errorCode: event.errorCode },
        },
      };
    case 'assessment_done':
      return { ...live, status: event.status, ended: 'done' };
    case 'assessment_gone':
      return { ...live, ended: 'gone' };
    case 'assessment_timeout':
      return state;
  }
}

/** A frame's payload as an event, or `null` when it is not one this page knows. */
function readEvent(data: unknown): ReviewEvent | null {
  if (typeof data !== 'string') return null;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = reviewEventSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export function useReviewEvents(
  id: string,
  initial: InitialProgress,
  onDone: (status: ReviewState) => void
): { progress: ReviewProgress; reconnect: () => void } {
  const [progress, dispatch] = useReducer(reduce, initial, (i) => ({
    status: i.status,
    quickScan: i.quickScan,
    runs: Object.fromEntries(i.runs.map((r) => [r.judge, r])),
    connection: 'live' as const,
    ended: null,
  }));
  // Bumped by `reconnect()`, so the effect opens a fresh stream.
  const [attempt, setAttempt] = useState(0);
  const done = useEffectEvent(onDone);

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    let stopped = false;

    const close = () => {
      source?.close();
      source = null;
    };

    const retry = () => {
      close();
      if (stopped) return;
      if (retries >= MAX_RETRIES) {
        dispatch({ kind: 'connection', connection: 'lost' });
        return;
      }
      retries += 1;
      dispatch({ kind: 'connection', connection: 'reconnecting' });
      timer = setTimeout(open, RETRY_MS * retries);
    };

    const onEvent = (frame: MessageEvent) => {
      const event = readEvent(frame.data);
      if (!event) {
        logger.warn('Review progress: an event this page cannot read', { assessmentId: id });
        return;
      }
      dispatch({ kind: 'event', event });
      switch (event.type) {
        case 'assessment_done':
          stopped = true;
          close();
          done(event.status);
          return;
        case 'assessment_gone':
          stopped = true;
          close();
          return;
        case 'assessment_timeout':
          // The server's bound, not a failure: carry on in a new stream.
          close();
          retries = 0;
          open();
          return;
        default:
          retries = 0;
      }
    };

    function open() {
      if (stopped) return;
      const es = new EventSource(assessmentEventsEndpoint(id));
      source = es;
      es.addEventListener('open', () => dispatch({ kind: 'connection', connection: 'live' }));
      for (const type of REVIEW_EVENT_TYPES) es.addEventListener(type, onEvent);
      es.addEventListener('error', (e) => {
        if (source !== es) return;
        // The server's own error frame carries data; the browser's does not.
        if ((e instanceof MessageEvent && e.data) || es.readyState === EventSource.CLOSED) {
          retry();
        } else {
          dispatch({ kind: 'connection', connection: 'reconnecting' });
        }
      });
    }

    open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      close();
    };
  }, [id, attempt]);

  const reconnect = () => {
    dispatch({ kind: 'connection', connection: 'reconnecting' });
    setAttempt((n) => n + 1);
  };
  return { progress, reconnect };
}
