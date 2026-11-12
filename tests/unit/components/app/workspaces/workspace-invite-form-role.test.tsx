// @vitest-environment happy-dom

/**
 * The invite form's role choice reaches the request (t-9).
 *
 * In its own file because the Radix select cannot be driven in happy-dom, so
 * it is replaced with a native one here, as core's support-grant form test
 * does. The rest of the form is covered in `workspace-invite-form.test.tsx`
 * against the real select.
 *
 * @see components/app/workspaces/workspace-invite-form.tsx
 */
import type React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { post: vi.fn(), get: vi.fn() },
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select data-testid="role-select" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value }: { value: string }) => <option value={value}>{value}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

import { WorkspaceInviteForm } from '@/components/app/workspaces/workspace-invite-form';
import { apiClient } from '@/lib/api/client';

describe('WorkspaceInviteForm role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.post).mockResolvedValue({ email: 'a@example.com', message: 'Sent.' });
  });

  it('sends the role picked, not the default', async () => {
    const user = userEvent.setup();
    render(<WorkspaceInviteForm orgId="org-1" />);

    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Ann');
    await user.type(screen.getByRole('textbox', { name: /^Email/ }), 'a@example.com');
    await user.selectOptions(screen.getByTestId('role-select'), 'ADMIN');
    await user.click(screen.getByRole('button', { name: /Send invitation/ }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect(vi.mocked(apiClient.post).mock.calls[0][1]).toEqual({
      body: { name: 'Ann', email: 'a@example.com', orgRole: 'ADMIN' },
    });
  });
});
