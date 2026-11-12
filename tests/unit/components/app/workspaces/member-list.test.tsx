// @vitest-environment happy-dom

/**
 * @see components/app/workspaces/member-list.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemberList } from '@/components/app/workspaces/member-list';
import type { WorkspaceMember } from '@/components/app/workspaces/schemas';

const member = (over: Partial<WorkspaceMember>): WorkspaceMember => ({
  id: 'u1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'MEMBER',
  joinedAt: new Date('2026-01-01'),
  ...over,
});

describe('MemberList', () => {
  it('shows a named member with their email beneath and a role label', () => {
    render(<MemberList members={[member({ role: 'ADMIN' })]} currentUserId="someone-else" />);

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(row).getByText('ada@example.com')).toBeInTheDocument();
    expect(within(row).getByText('Admin')).toBeInTheDocument();
  });

  it('shows the email as the title, once, when a member has no name', () => {
    render(<MemberList members={[member({ name: null })]} currentUserId="x" />);

    expect(screen.getAllByText('ada@example.com')).toHaveLength(1);
  });

  it('labels each role as Owner, Admin or Member', () => {
    render(
      <MemberList
        members={[
          member({ id: 'a', name: 'A', role: 'OWNER' }),
          member({ id: 'b', name: 'B', role: 'ADMIN' }),
          member({ id: 'c', name: 'C', role: 'MEMBER' }),
        ]}
        currentUserId="x"
      />
    );

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Owner')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Admin')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Member')).toBeInTheDocument();
  });

  it('marks only the signed-in person with (you)', () => {
    render(
      <MemberList
        members={[member({ id: 'me', name: 'Me' }), member({ id: 'other', name: 'Other' })]}
        currentUserId="me"
      />
    );

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('(you)')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('(you)')).not.toBeInTheDocument();
  });
});
