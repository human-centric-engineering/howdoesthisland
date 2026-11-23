// @vitest-environment happy-dom

/**
 * A project's weighting (t-72): shown only when the version declares bounds,
 * offering only what they let move, and saving the overlay.
 *
 * @see components/app/projects/project-weights.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { patch: vi.fn() },
}));

import { ProjectWeights } from '@/components/app/projects/project-weights';
import { apiClient, APIClientError } from '@/lib/api/client';
import { BOUNDS, aCatalogue, aProject } from '@/tests/unit/components/app/projects/fixtures';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectWeights', () => {
  it('shows nothing for a version without bounds and a project without an adjustment', () => {
    const { container } = render(<ProjectWeights project={aProject()} catalogue={aCatalogue()} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Weighting')).toBeNull();
  });

  it('offers only the appeals the version lets move, with their limits, and core dimensions', () => {
    render(<ProjectWeights project={aProject()} catalogue={aCatalogue({ adjustment: BOUNDS })} />);

    expect(screen.getByRole('form', { name: 'Weighting' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /^Ethos, in points/ })).toHaveAttribute(
      'max',
      '10'
    );
    expect(screen.getByRole('spinbutton', { name: /^Pathos, in points/ })).toHaveAttribute(
      'max',
      '5'
    );
    expect(screen.queryByRole('spinbutton', { name: /^Logos, in points/ })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: /^Kairos, in points/ })).toBeNull();
    // A reviewer group's dimension (no core appeal) is never offered.
    expect(screen.getAllByRole('checkbox', { name: 'Integrity' })).toHaveLength(2);
    expect(screen.queryByRole('checkbox', { name: 'Rhythm' })).toBeNull();
  });

  it('saves the adjustment as shares of the mix', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({});
    const user = userEvent.setup();
    render(<ProjectWeights project={aProject()} catalogue={aCatalogue({ adjustment: BOUNDS })} />);

    await user.clear(screen.getByRole('spinbutton', { name: /^Ethos, in points/ }));
    await user.type(screen.getByRole('spinbutton', { name: /^Ethos, in points/ }), '8');
    const [makePriority] = screen.getAllByRole('checkbox', { name: 'Call to action' });
    await user.click(makePriority);
    await user.click(screen.getByRole('button', { name: 'Save weighting' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/projects/proj-1', {
      body: { overlay: { weights: { ethos: 0.08 }, priorityDimensions: { add: ['kai_call'] } } },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });

  it('refuses a move past the limit before saving', async () => {
    const user = userEvent.setup();
    render(<ProjectWeights project={aProject()} catalogue={aCatalogue({ adjustment: BOUNDS })} />);

    await user.clear(screen.getByRole('spinbutton', { name: /^Pathos, in points/ }));
    await user.type(screen.getByRole('spinbutton', { name: /^Pathos, in points/ }), '-6');
    await user.click(screen.getByRole('button', { name: 'Save weighting' }));

    expect(await screen.findByText('At most 5 either way')).toBeInTheDocument();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it('lets no more priorities be chosen than the version allows', async () => {
    const user = userEvent.setup();
    render(<ProjectWeights project={aProject()} catalogue={aCatalogue({ adjustment: BOUNDS })} />);

    const [integrity] = screen.getAllByRole('checkbox', { name: 'Integrity' });
    await user.click(integrity);

    const [goodwill] = screen.getAllByRole('checkbox', { name: 'Goodwill' });
    expect(goodwill).toBeDisabled();
  });

  it('puts the API’s refusal under the field it names', async () => {
    vi.mocked(apiClient.patch).mockRejectedValue(
      new APIClientError('No', 'OVERLAY_INVALID', 400, {
        issues: [{ path: 'overlay.weights.ethos', message: 'Too far for this version' }],
      })
    );
    const user = userEvent.setup();
    render(<ProjectWeights project={aProject()} catalogue={aCatalogue({ adjustment: BOUNDS })} />);

    await user.type(screen.getByRole('spinbutton', { name: /^Ethos, in points/ }), '5');
    await user.click(screen.getByRole('button', { name: 'Save weighting' }));

    expect(await screen.findByText('Too far for this version')).toBeInTheDocument();
  });

  it('starts from the stored adjustment, and clears it by setting everything back', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({});
    const user = userEvent.setup();
    render(
      <ProjectWeights
        project={aProject({ overlay: { weights: { ethos: 0.05 } } })}
        catalogue={aCatalogue({ adjustment: BOUNDS })}
      />
    );

    expect(screen.getByRole('spinbutton', { name: /^Ethos, in points/ })).toHaveValue(5);
    await user.clear(screen.getByRole('spinbutton', { name: /^Ethos, in points/ }));
    await user.type(screen.getByRole('spinbutton', { name: /^Ethos, in points/ }), '0');
    await user.click(screen.getByRole('button', { name: 'Save weighting' }));

    await waitFor(() =>
      expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/projects/proj-1', {
        body: { overlay: null },
      })
    );
  });

  it('says why reviews are refused when the version allows none, and removes it', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({});
    const user = userEvent.setup();
    render(
      <ProjectWeights
        project={aProject({ overlay: { weights: { ethos: 0.05 } } })}
        catalogue={aCatalogue()}
      />
    );

    expect(screen.getByText(/Ethos \+5 points/)).toBeInTheDocument();
    expect(screen.getByText(/refused until the adjustment is removed/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove the adjustment' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/projects/proj-1', {
      body: { overlay: null },
    });
  });

  it('keeps an appeal the version no longer lets move, so its value is seen', () => {
    render(
      <ProjectWeights
        project={aProject({ overlay: { weights: { logos: 0.05 } } })}
        catalogue={aCatalogue({ adjustment: BOUNDS })}
      />
    );

    expect(screen.getByRole('spinbutton', { name: /^Logos, in points/ })).toHaveValue(5);
  });

  it('keeps a priority list the version no longer offers while the project uses it', () => {
    render(
      <ProjectWeights
        project={aProject({ overlay: { priorityDimensions: { remove: ['kai_call'] } } })}
        catalogue={aCatalogue({
          adjustment: { ...BOUNDS, priorityDimensions: { add: 0, remove: 0 } },
        })}
      />
    );

    expect(screen.getByText(/^No longer a priority/)).toBeInTheDocument();
    expect(screen.queryByText(/^Make a priority/)).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Call to action' })).toBeChecked();
  });

  it('says when the stored adjustment is in a shape it cannot show, and lets it be replaced', () => {
    render(
      <ProjectWeights
        project={aProject({ overlay: { weights: 'lots' } })}
        catalogue={aCatalogue({ adjustment: BOUNDS })}
      />
    );

    expect(screen.getByRole('note')).toHaveTextContent(/not in a shape this page can show/);
    expect(screen.getByRole('button', { name: 'Save weighting' })).toBeEnabled();
  });

  it('shows a refusal it cannot place by Save, and any other failure', async () => {
    vi.mocked(apiClient.patch)
      .mockRejectedValueOnce(
        new APIClientError('No', 'OVERLAY_INVALID', 400, {
          issues: [{ path: 'overlay', message: 'This version declares no bounds' }],
        })
      )
      .mockRejectedValueOnce(new APIClientError('Down', 'INTERNAL_ERROR', 500));
    const user = userEvent.setup();
    render(<ProjectWeights project={aProject()} catalogue={aCatalogue({ adjustment: BOUNDS })} />);

    await user.type(screen.getByRole('spinbutton', { name: /^Ethos, in points/ }), '5');
    await user.click(screen.getByRole('button', { name: 'Save weighting' }));
    expect(await screen.findByText('This version declares no bounds')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save weighting' }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('This version declares no bounds')).toBeNull();
  });

  it('shows a failed removal beside its button', async () => {
    vi.mocked(apiClient.patch).mockRejectedValue(new APIClientError('Down', 'INTERNAL_ERROR', 500));
    const user = userEvent.setup();
    render(
      <ProjectWeights
        project={aProject({ overlay: { weights: 'lots' } })}
        catalogue={aCatalogue()}
      />
    );

    expect(screen.getByText(/The latest model version allows no adjustment/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove the adjustment' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('shows a stored priority this version lacks, ticked, so it can be removed (review round 1)', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({});
    const user = userEvent.setup();
    render(
      <ProjectWeights
        project={aProject({ overlay: { priorityDimensions: { add: ['dim_gone'] } } })}
        catalogue={aCatalogue({ adjustment: BOUNDS })}
      />
    );

    // In both lists; ticked in the one it was stored in.
    const [gone, inRemove] = screen.getAllByRole('checkbox', {
      name: 'dim_gone (not in this version)',
    });
    expect(gone).toBeChecked();
    expect(inRemove).not.toBeChecked();
    await user.click(gone);
    await user.click(screen.getByRole('button', { name: 'Save weighting' }));

    await waitFor(() =>
      expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/projects/proj-1', {
        body: { overlay: null },
      })
    );
  });

  it('drops a cleared row once the refreshed project no longer holds it, keeping "Saved." (review round 3)', () => {
    const catalogue = aCatalogue({ adjustment: BOUNDS });
    const { rerender } = render(
      <ProjectWeights
        project={aProject({ overlay: { priorityDimensions: { add: ['dim_gone'] } } })}
        catalogue={catalogue}
      />
    );
    expect(screen.getAllByRole('checkbox', { name: /dim_gone/ })).toHaveLength(2);

    rerender(<ProjectWeights project={aProject()} catalogue={catalogue} />);

    expect(screen.queryByRole('checkbox', { name: /dim_gone/ })).toBeNull();
  });
});
