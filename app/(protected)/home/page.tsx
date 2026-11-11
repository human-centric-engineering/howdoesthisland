import type { Metadata } from 'next';
import { HomeEmptyState } from '@/components/app/shell/home-empty-state';

export const metadata: Metadata = { title: 'Home' };

/**
 * `/home` — where a signed-in person lands (D22, through `lib/app/auth-landing.ts`).
 * For now an empty desk; `b2` fills it with recent work and projects.
 */
export default function HomePage() {
  return <HomeEmptyState />;
}
