'use client';

/**
 * A comparison as it moves (t-89): read again from
 * `GET /api/v1/comparisons/{id}` every {@link POLL_MS} while a draft is still
 * running or the verdict is still to come, then left alone.
 *
 * Read, not streamed: the one enriched read carries every draft's state and
 * scores and the verdict, which has no stream of its own, so a stream per
 * draft (`use-review-events.ts`) would still leave the verdict to be read
 * this way, and up to five open streams would take most of the browser's six
 * connections to the site.
 *
 * A read that fails, or a reply that does not parse, keeps what is shown and
 * tries again at the next tick; after {@link MAX_MISSES} in a row it says so
 * (`stale`), and keeps trying. A tab in the background is not read; it is
 * read as soon as it is shown again.
 */
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api/client';
import { logger } from '@/lib/logging';
import {
  comparisonEndpoint,
  comparisonSchema,
  isMoving,
  type Comparison,
} from '@/components/app/compare/schemas';

/** How often a moving comparison is read again. */
export const POLL_MS = 4_000;
/** Failed reads in a row before the page says it may be out of date. */
export const MAX_MISSES = 3;

export function useComparison(initial: Comparison): { comparison: Comparison; stale: boolean } {
  const [comparison, setComparison] = useState(initial);
  const [misses, setMisses] = useState(0);
  const moving = isMoving(comparison);
  const id = comparison.id;

  useEffect(() => {
    if (!moving) return;
    let stopped = false;
    let inFlight = false;

    const read = async () => {
      if (inFlight || stopped || document.hidden) return;
      inFlight = true;
      try {
        const data = await apiClient.get<unknown>(comparisonEndpoint(id));
        if (stopped) return;
        const parsed = comparisonSchema.safeParse(data);
        if (parsed.success) {
          setComparison(parsed.data);
          setMisses(0);
        } else {
          logger.warn('Comparison: a reply this page cannot read', { comparisonId: id });
          setMisses((n) => n + 1);
        }
      } catch {
        if (!stopped) setMisses((n) => n + 1);
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(() => void read(), POLL_MS);
    const onShown = () => {
      if (!document.hidden) void read();
    };
    document.addEventListener('visibilitychange', onShown);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShown);
    };
  }, [id, moving]);

  return { comparison, stale: misses >= MAX_MISSES };
}
