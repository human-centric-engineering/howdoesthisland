// @vitest-environment happy-dom

/**
 * WorkspaceSlot shows the switcher at TENANCY_MODE=multi and nothing at
 * single, where every account shares the install org.
 *
 * @see components/app/shell/workspace-slot.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const isMultiTenant = vi.hoisted(() => vi.fn());

vi.mock('@/lib/tenancy/context', () => ({ isMultiTenant }));
vi.mock('@/components/app/workspaces/workspace-switcher', () => ({
  WorkspaceSwitcher: () => <div data-testid="switcher" />,
}));

import { WorkspaceSlot } from '@/components/app/shell/workspace-slot';

describe('WorkspaceSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the workspace switcher when the install is multi-tenant', () => {
    isMultiTenant.mockReturnValue(true);

    render(<WorkspaceSlot />);

    expect(screen.getByTestId('switcher')).toBeInTheDocument();
  });

  it('renders nothing when the install is single-tenant', () => {
    isMultiTenant.mockReturnValue(false);

    const { container } = render(<WorkspaceSlot />);

    expect(container).toBeEmptyDOMElement();
  });
});
