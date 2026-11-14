// @vitest-environment happy-dom

/**
 * @see components/app/settings/judge-models.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const m = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { patch: vi.fn(), get: vi.fn() },
}));

import { JudgeModels } from '@/components/app/settings/judge-models';
import type { JudgeModelChoiceView } from '@/components/app/settings/schemas';
import { apiClient, APIClientError } from '@/lib/api/client';

const OPTIONS = [
  { model: 'model-fast', label: 'Fast One', tradeoff: 'Quick and cheap.', isDefault: true },
  { model: 'model-deep', label: 'Deep One', tradeoff: 'Slower, more careful.', isDefault: false },
];

function agent(overrides: Partial<JudgeModelChoiceView> = {}): JudgeModelChoiceView {
  return {
    key: 'judge-a',
    name: 'Alpha Judge',
    role: 'judge',
    current: { model: 'model-fast', label: 'Fast One', approved: true },
    followsDefault: true,
    options: OPTIONS,
    ...overrides,
  };
}

const AGENTS: JudgeModelChoiceView[] = [
  agent(),
  agent({
    key: 'editor-b',
    name: 'Beta Editor',
    role: 'editor',
    current: { model: 'model-deep', label: 'Deep One', approved: true },
    followsDefault: false,
  }),
];

function setup(agents: JudgeModelChoiceView[] = AGENTS, orgId = 'org-1') {
  const user = userEvent.setup();
  render(<JudgeModels orgId={orgId} agents={agents} />);
  return { user };
}

const trigger = (name: string) => screen.getByRole('combobox', { name: new RegExp(`^${name}`) });
const saveButton = () => screen.getByRole('button', { name: /Save models/ });

describe('JudgeModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders each agent name with its current pick, Default when it follows the default', () => {
    setup();

    expect(trigger('Alpha Judge')).toHaveTextContent('Default (Fast One)');
    expect(trigger('Beta Editor')).toHaveTextContent('Deep One');
    expect(trigger('Beta Editor')).not.toHaveTextContent('Default');
  });

  it('shows the trade-off of the chosen option, and the recommendation text for Default', () => {
    setup();

    expect(screen.getByText('Our recommended model for this job.')).toBeInTheDocument();
    expect(screen.getByText('Slower, more careful.')).toBeInTheDocument();
    expect(screen.queryByText('Quick and cheap.')).not.toBeInTheDocument();
  });

  it('shows no token, temperature or effort settings', () => {
    setup();

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/token/i);
    expect(text).not.toMatch(/temperature/i);
    expect(text).not.toMatch(/effort/i);
  });

  it('disables Save until a pick changes', async () => {
    const { user } = setup();

    expect(saveButton()).toBeDisabled();

    await user.click(trigger('Alpha Judge'));
    await user.click(screen.getByRole('option', { name: 'Deep One' }));

    expect(saveButton()).toBeEnabled();
  });

  it('disables Save again when a pick is changed back to what it was', async () => {
    const { user } = setup();

    await user.click(trigger('Alpha Judge'));
    await user.click(screen.getByRole('option', { name: 'Deep One' }));
    await user.click(trigger('Alpha Judge'));
    await user.click(screen.getByRole('option', { name: 'Default (Fast One)' }));

    expect(saveButton()).toBeDisabled();
  });

  it('PATCHes only the changed agent with the chosen model id, then refreshes', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue(
      agent({
        current: { model: 'model-deep', label: 'Deep One', approved: true },
        followsDefault: false,
      })
    );
    const { user } = setup(AGENTS, 'org 7');

    await user.click(trigger('Alpha Judge'));
    await user.click(screen.getByRole('option', { name: 'Deep One' }));
    await user.click(saveButton());

    await waitFor(() => expect(m.refresh).toHaveBeenCalledTimes(1));
    expect(apiClient.patch).toHaveBeenCalledTimes(1);
    expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/workspaces/org%207/judges/judge-a', {
      body: { model: 'model-deep' },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    // The saved pick is now the baseline, so there is nothing left to save.
    expect(saveButton()).toBeDisabled();
  });

  it('sends model null when Default is chosen', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue(
      agent({
        key: 'editor-b',
        name: 'Beta Editor',
        role: 'editor',
        current: { model: 'model-fast', label: 'Fast One', approved: true },
        followsDefault: true,
      })
    );
    const { user } = setup();

    await user.click(trigger('Beta Editor'));
    await user.click(screen.getByRole('option', { name: 'Default (Fast One)' }));
    await user.click(saveButton());

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled());
    expect(apiClient.patch).toHaveBeenCalledTimes(1);
    expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/workspaces/org-1/judges/editor-b', {
      body: { model: null },
    });
  });

  it('shows the save error and does not refresh when the server refuses', async () => {
    vi.mocked(apiClient.patch).mockRejectedValue(
      new APIClientError('That model is not approved for this job.', 'MODEL_NOT_APPROVED', 400)
    );
    const { user } = setup();

    await user.click(trigger('Alpha Judge'));
    await user.click(screen.getByRole('option', { name: 'Deep One' }));
    await user.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That model is not approved for this job.'
    );
    expect(m.refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // The failed change is still pending, so Save stays available to retry.
    expect(saveButton()).toBeEnabled();
  });

  it('falls back to a generic message when the failure carries none', async () => {
    vi.mocked(apiClient.patch).mockRejectedValue(new Error('network down'));
    const { user } = setup();

    await user.click(trigger('Alpha Judge'));
    await user.click(screen.getByRole('option', { name: 'Deep One' }));
    await user.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be saved/i);
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('shows a current model that is off the options as "(no longer offered)"', () => {
    setup([
      agent({
        current: { model: 'model-old', label: 'Old One', approved: false },
        followsDefault: false,
      }),
    ]);

    expect(trigger('Alpha Judge')).toHaveTextContent('Old One (no longer offered)');
    expect(screen.getByText('Not approved for this job: choose another.')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('shows a workspace-owned agent with no model as unchosen, and lets Default be saved', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue(agent());
    const { user } = setup([agent({ current: null, followsDefault: false })]);

    expect(trigger('Alpha Judge')).toHaveTextContent('No model chosen');
    expect(trigger('Alpha Judge')).not.toHaveTextContent('Default');
    expect(saveButton()).toBeDisabled();

    await user.click(trigger('Alpha Judge'));
    await user.click(screen.getByRole('option', { name: 'Default (Fast One)' }));
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1));
    expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/workspaces/org-1/judges/judge-a', {
      body: { model: null },
    });
  });
  it('lets an unchosen agent be put back as it was, leaving nothing to save', async () => {
    const { user } = setup([agent({ current: null, followsDefault: false })]);

    await user.click(trigger('Alpha Judge'));
    await user.click(screen.getByRole('option', { name: 'Deep One' }));
    expect(saveButton()).toBeEnabled();
    await user.click(trigger('Alpha Judge'));
    await user.click(screen.getByRole('option', { name: 'No model chosen' }));

    expect(saveButton()).toBeDisabled();
  });
});
