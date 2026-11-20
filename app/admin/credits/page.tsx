import type { Metadata } from 'next';

import { CreditsPanel } from '@/components/app/admin/credits/credits-panel';
import { FieldHelp } from '@/components/ui/field-help';
import { requireServerData } from '@/lib/api/server-load';
import { ADMIN_CREDITS_ENDPOINT, adminCreditsListSchema, MAX_SEARCH } from '@/lib/app/credits/wire';
import { WORDS } from '@/lib/app/reports/words';

export const metadata: Metadata = {
  title: 'CopyCredits',
  description: 'Each workspace’s CopyCredits, and granting or adjusting them.',
};

/**
 * Admin — CopyCredits (t-57).
 *
 * Thin server shell over `GET /api/v1/admin/credits`. The admin tree is
 * platform-admin only for this page (it is in no org tier), and so are the
 * routes: a workspace owner cannot grant themselves credits. A failed load
 * throws to the admin error boundary rather than rendering an empty list.
 */
export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  // Cut to what the route accepts: a longer search from a hand-edited URL
  // would otherwise be refused, and the page would fail to load.
  const query = ((Array.isArray(q) ? q[0] : q)?.trim() ?? '').slice(0, MAX_SEARCH);
  const { data } = await requireServerData<unknown>(
    query ? `${ADMIN_CREDITS_ENDPOINT}?q=${encodeURIComponent(query)}` : ADMIN_CREDITS_ENDPOINT
  );
  const list = adminCreditsListSchema.parse(data);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">
          CopyCredits{' '}
          <FieldHelp title="What are CopyCredits?">
            <p>
              What a workspace pays for reviews by {WORDS.aiReviewers} with. A new workspace starts
              with none; it gets them from a free review code, or from a grant here.
            </p>
            <p className="mt-2">
              To begin with, 100 credits is about $1 of AI cost, and a review is charged for what it
              actually spent. Every change is kept, with who made it and why.
            </p>
          </FieldHelp>
        </h1>
        <p className="text-muted-foreground text-sm">
          Each active workspace&rsquo;s credits and what its monthly spending limit leaves. Change
          one to grant or adjust its credits.
        </p>
      </header>

      {/* Keyed by the search, so a new one starts the panel afresh: its box and its banner. */}
      <CreditsPanel key={query} initial={list} query={query} />
    </div>
  );
}
