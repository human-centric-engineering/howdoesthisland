/**
 * The app's admin nav (t-38): the Frameworks page, for platform admins only.
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
