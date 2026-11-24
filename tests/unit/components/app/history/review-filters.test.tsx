// @vitest-environment happy-dom

/**
 * The review filters (t-79): each choice goes into the address, back to the
 * first page, and "Any" takes the filter off.
 *
 * @see components/app/history/review-filters.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push }) }));
vi.mock('@/components/ui/select', async () => {
  const { selectMock } = await import('@/tests/unit/components/app/projects/select-mock');
  return selectMock;
});

import { ANY, ReviewFilters } from '@/components/app/history/review-filters';
import type { FilterCatalogue } from '@/components/app/history/schemas';

const catalogue: FilterCatalogue = {
  request: {
    contentTypes: [
      { id: 'landing_page', name: 'Landing page' },
      { id: 'cv_resume', name: 'CV' },
    ],
  },
  result: { bands: ['Weak', 'Developing', 'Strong'] },
};
const projects = [{ id: 'proj-1', name: 'Spring launch' }];

beforeEach(() => vi.clearAllMocks());

describe('ReviewFilters', () => {
  it('offers the projects, the types of copy and the bands, each with Any', () => {
    render(
      <ReviewFilters basePath="/home" filter={{}} catalogue={catalogue} projects={projects} />
    );

    expect(screen.getByLabelText('Project')).toHaveValue(ANY);
    expect(screen.getByRole('option', { name: 'Spring launch' })).toBeInTheDocument();
    expect(screen.getByLabelText('Type of copy')).toHaveValue(ANY);
    expect(screen.getByRole('option', { name: 'Landing page' })).toBeInTheDocument();
    expect(
      Array.from(screen.getByLabelText('Band').querySelectorAll('option')).map((o) => o.textContent)
    ).toEqual(['Any', 'Weak', 'Developing', 'Strong']);
    expect(screen.queryByRole('link', { name: 'Clear filters' })).toBeNull();
  });

  it('puts a choice in the address beside the others, starting at the first page', async () => {
    const user = userEvent.setup();
    render(
      <ReviewFilters
        basePath="/home"
        filter={{ band: 'Strong' }}
        catalogue={catalogue}
        projects={projects}
      />
    );

    await user.selectOptions(screen.getByLabelText('Type of copy'), 'landing_page');
    expect(push).toHaveBeenLastCalledWith('/home?contentType=landing_page&band=Strong');

    await user.selectOptions(screen.getByLabelText('Project'), 'proj-1');
    expect(push).toHaveBeenLastCalledWith('/home?projectId=proj-1&band=Strong');
  });

  it('takes a filter off with Any, and offers to clear them all', async () => {
    const user = userEvent.setup();
    render(
      <ReviewFilters
        basePath="/home"
        filter={{ band: 'Strong', contentType: 'cv_resume' }}
        catalogue={catalogue}
        projects={projects}
      />
    );

    await user.selectOptions(screen.getByLabelText('Band'), ANY);
    expect(push).toHaveBeenLastCalledWith('/home?contentType=cv_resume');
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute('href', '/home');
  });

  it('still names a filter its choices lack, and offers no project filter when given none', () => {
    render(
      <ReviewFilters
        basePath="/home"
        filter={{ contentType: 'haiku' }}
        catalogue={catalogue}
        projects={null}
      />
    );

    expect(screen.getByLabelText('Type of copy')).toHaveValue('haiku');
    expect(screen.queryByLabelText('Project')).toBeNull();
  });
});
