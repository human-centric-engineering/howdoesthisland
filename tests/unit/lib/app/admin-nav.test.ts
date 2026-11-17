/**
 * The app's admin nav (t-38): the Frameworks page, for platform admins only.
 *
 * FORK NOTE — this file tests this fork's own filling of the admin-nav seam,
 * so it reads `@/lib/app/admin-nav` for real on purpose. A change to the nav
 * should change these expectations; the shipped-empty row is pinned
 * separately in tests/unit/lib/app/defaults.test.ts (ledger row 2).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { initAppNav } from '@/lib/app/admin-nav';
import { __resetNavRegistryForTests, getRegisteredNavSections } from '@/lib/admin-nav/registry';

afterEach(() => __resetNavRegistryForTests());

describe('initAppNav()', () => {
  it('registers the Frameworks page with no tier, so only a platform admin sees it', () => {
    initAppNav();
    const items = getRegisteredNavSections().flatMap((s) => s.items ?? []);
    const item = items.find((i) => i.href === '/admin/frameworks');
    expect(item).toMatchObject({ label: 'Frameworks' });
    expect(item?.tier).toBeUndefined();
  });
});
