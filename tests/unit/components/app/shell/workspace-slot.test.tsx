// @vitest-environment happy-dom

/**
 * WorkspaceSlot renders nothing until f-workspaces fills it, so the signed-in
 * header shows no empty switcher.
 *
 * @see components/app/shell/workspace-slot.tsx
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WorkspaceSlot } from '@/components/app/shell/workspace-slot';

describe('WorkspaceSlot', () => {
  it('renders nothing while there are no workspaces', () => {
    const { container } = render(<WorkspaceSlot />);
    expect(container).toBeEmptyDOMElement();
  });
});
