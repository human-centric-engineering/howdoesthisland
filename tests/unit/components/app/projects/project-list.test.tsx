// @vitest-environment happy-dom

/**
 * The projects list (t-71): rows from the one list call, the archived toggle.
 *
 * @see components/app/projects/project-list.tsx
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { ProjectList, reviewCount } from '@/components/app/projects/project-list';
import { aProject } from '@/tests/unit/components/app/projects/fixtures';

describe('ProjectList', () => {
  it('lists each project, linked to its page, with its reviews', () => {
    render(
      <ProjectList
        projects={[
          aProject(),
          aProject({ id: 'proj-2', name: 'Help centre', reviewCount: 1, archived: true }),
        ]}
        total={2}
        showArchived
      />
    );

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('link', { name: 'Spring launch' })).toHaveAttribute(
      'href',
      '/projects/proj-1'
    );
    expect(rows[0]).toHaveTextContent('3 reviews');
    expect(rows[1]).toHaveTextContent('Archived');
    expect(rows[1]).toHaveTextContent('1 review');
    expect(screen.getByRole('link', { name: 'Hide archived projects' })).toHaveAttribute(
      'href',
      '/projects'
    );
  });

  it('offers the archived ones behind a toggle, and a new project', () => {
    render(<ProjectList projects={[aProject()]} total={1} showArchived={false} />);

    expect(screen.getByRole('link', { name: 'Show archived projects' })).toHaveAttribute(
      'href',
      '/projects?archived=true'
    );
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 project');
  });

  it('says when the workspace has more than the list shows', () => {
    render(<ProjectList projects={[aProject()]} total={140} showArchived={false} />);

    expect(screen.getByRole('status')).toHaveTextContent('The newest 1 of 140 projects');
  });

  it('says so when there are none', () => {
    render(<ProjectList projects={[]} total={0} showArchived={false} />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('No projects open')).toBeInTheDocument();
  });

  it('counts reviews in the glossary’s word', () => {
    expect(reviewCount(0)).toBe('0 reviews');
    expect(reviewCount(1)).toBe('1 review');
    expect(reviewCount(1200)).toBe('1,200 reviews');
  });
});
