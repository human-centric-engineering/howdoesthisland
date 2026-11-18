// @vitest-environment happy-dom

/**
 * @see components/app/account/api-keys-section.tsx
 * @see lib/app/account-sections.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ApiKeysSection } from '@/components/app/account/api-keys-section';
import { AccountSections } from '@/components/account/account-sections';
import { __resetAccountSectionRegistryForTests } from '@/lib/account-sections/registry';

describe('ApiKeysSection', () => {
  afterEach(() => __resetAccountSectionRegistryForTests());

  it('links to the API-keys page', () => {
    render(<ApiKeysSection userId="user-1" />);
    expect(screen.getByRole('link', { name: 'Manage API keys' })).toHaveAttribute(
      'href',
      '/settings/api-keys'
    );
  });

  it('renders at the foot of /settings through the real seam, and not on /profile', () => {
    __resetAccountSectionRegistryForTests();
    const { unmount } = render(<AccountSections surface="settings" userId="user-1" />);
    expect(screen.getByRole('link', { name: 'Manage API keys' })).toBeInTheDocument();
    unmount();

    render(<AccountSections surface="profile" userId="user-1" />);
    expect(screen.queryByRole('link', { name: 'Manage API keys' })).toBeNull();
  });
});
