import type { Metadata } from 'next';
import { getServerSession } from '@/lib/auth/utils';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { HomeEmptyState } from '@/components/app/shell/home-empty-state';

export const metadata: Metadata = { title: 'Home' };

/**
 * `/home` — where a signed-in person lands (D22, through `lib/app/auth-landing.ts`).
 * For now an empty desk; `b2` fills it with recent work and projects.
 *
 * The proxy only checks that a session cookie exists, and it sends anyone with
 * one away from the login page to here. So a cookie whose session has expired
 * or been revoked must be cleared here, as `/dashboard` does, or that person
 * can never reach the login form.
 */
export default async function HomePage() {
  const session = await getServerSession();
  if (!session) {
    clearInvalidSession('/home');
  }

  return <HomeEmptyState />;
}
