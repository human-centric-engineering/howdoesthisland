'use client';

import Link from 'next/link';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Source } from '@/lib/app/explainer/sources';

/**
 * A citation that opens in place (t-63): who, what, when and why it matters,
 * for a reader meeting the source for the first time, with a link to read
 * more and to the full source list. Nothing to leave the page for.
 */
export function SourceChip({ source }: { source: Source }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-8 items-center rounded-full border border-(--hd-rule) px-3 text-sm hover:border-(--hd-ink) focus-visible:ring-2 focus-visible:ring-(--hd-ink) focus-visible:outline-none"
          aria-label={`Source: ${source.cite}. Open for details.`}
        >
          {source.cite}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] space-y-2 text-sm">
        <p className="font-semibold">{source.title}</p>
        <p className="text-muted-foreground">
          {source.who}, {source.when}.
        </p>
        <p className="leading-relaxed">{source.context}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          {source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              Read more
            </a>
          )}
          <Link href={`/model/sources#${source.id}`} className="underline underline-offset-4">
            All sources
          </Link>
        </p>
      </PopoverContent>
    </Popover>
  );
}
