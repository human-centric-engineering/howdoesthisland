import type { Metadata } from 'next';

import { CodesPanel } from '@/components/app/admin/codes/codes-panel';
import { FieldHelp } from '@/components/ui/field-help';
import { requireServerData } from '@/lib/api/server-load';
import {
  ADMIN_CODES_ENDPOINT,
  adminCodesListSchema,
  dateFromNow,
  DEFAULT_EXPIRY_DAYS,
  MAX_EXPIRY_DAYS,
  MAX_CODE_SEARCH,
} from '@/lib/app/credits/codes/wire';

export const metadata: Metadata = {
  title: 'Review codes',
  description: 'Free review codes and their QR cards: make, list and revoke them.',
};

/**
 * Admin — free review codes (t-59).
 *
 * Thin server shell over `GET /api/v1/admin/codes`. Platform admins only, as
 * the routes are: the page is in no org tier. A failed load throws to the
 * admin error boundary rather than rendering an empty list.
 */
export default async function CodesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  // Cut to what the route accepts, by code point, as /admin/credits does.
  const query = Array.from((Array.isArray(q) ? q[0] : q)?.trim() ?? '')
    .slice(0, MAX_CODE_SEARCH)
    .join('');
  const { data } = await requireServerData<unknown>(
    query ? `${ADMIN_CODES_ENDPOINT}?q=${encodeURIComponent(query)}` : ADMIN_CODES_ENDPOINT
  );
  const list = adminCodesListSchema.parse(data);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">
          Review codes{' '}
          <FieldHelp title="What is a review code?">
            <p>
              A code that gives the workspace that redeems it CopyCredits, enough for a free review.
              Hand someone a personal code, or print a QR card that several people can scan.
            </p>
            <p className="mt-2">
              Someone who follows a code&rsquo;s link signs up or signs in, and the credits go to
              their workspace.
            </p>
          </FieldHelp>
        </h1>
        <p className="text-muted-foreground text-sm">
          Make codes for a campaign, see how many uses each has left, print their QR, and revoke one
          that should stop working.
        </p>
      </header>

      {/* Keyed by the search, so a new one starts the panel afresh. */}
      <CodesPanel
        key={query}
        initial={list}
        query={query}
        defaultExpiry={dateFromNow(DEFAULT_EXPIRY_DAYS)}
        minExpiry={dateFromNow(0)}
        maxExpiry={dateFromNow(MAX_EXPIRY_DAYS - 1)}
      />
    </div>
  );
}
