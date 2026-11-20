/**
 * `/usage` (t-48): the workspace's reviews, AI reviewer calls and spend this
 * month, against its monthly budget.
 *
 * A thin shell over `GET /api/v1/usage` (API-first): the page parses what the
 * API answers and renders it. Protected by the proxy through
 * `lib/app/protected-routes.ts`; an expired session is cleared here, as
 * `/home` does, so the person can reach the login form.
 */
import type { Metadata } from 'next';
import { getServerSession } from '@/lib/auth/utils';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { requireServerData } from '@/lib/api/server-load';
import { monthUsageSchema, USAGE_ENDPOINT } from '@/lib/app/usage/wire';
import { UsageSummary } from '@/components/app/usage/usage-summary';

export const metadata: Metadata = {
  title: 'Usage',
  description: 'This workspace’s reviews and AI spend this month, against its budget',
};

export default async function UsagePage() {
  const session = await getServerSession();
  if (!session) clearInvalidSession('/usage');

  const loaded = await requireServerData<unknown>(USAGE_ENDPOINT);
  return <UsageSummary usage={monthUsageSchema.parse(loaded.data)} />;
}
