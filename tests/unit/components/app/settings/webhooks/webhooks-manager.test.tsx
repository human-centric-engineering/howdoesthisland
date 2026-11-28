// @vitest-environment happy-dom

/**
 * @see components/app/settings/webhooks/webhooks-manager.tsx
 * @see components/app/settings/webhooks/schemas.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { post: vi.fn(), patch: vi.fn(), delete: vi.fn(), get: vi.fn() },
}));

import { WebhooksManager } from '@/components/app/settings/webhooks/webhooks-manager';
import {
  deliveryStatusLabel,
  deliveryStatusVariant,
  type SubscriptionRow,
} from '@/components/app/settings/webhooks/schemas';
import { apiClient, APIClientError } from '@/lib/api/client';
import { MAX_SUBSCRIPTIONS_PER_WORKSPACE } from '@/lib/app/events/types';

const ORG = 'cmorg000000000000000team1';
const BASE = `/api/v1/workspaces/${ORG}/event-subscriptions`;
const PROJECTS = [{ id: 'cmproj00000000000000proj1', name: 'Spring launch' }];

function row(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 'hook-1',
    name: 'CMS',
    eventType: 'app.assessment.finished',
    url: 'https://cms.example.com/hook',
    projectId: null,
    isEnabled: true,
    createdAt: '2026-11-27T10:00:00.000Z',
    createdByName: 'Sam',
    lastDelivery: null,
    ...overrides,
  };
}

function setup(subscriptions: SubscriptionRow[] = [row()]) {
  const user = userEvent.setup();
  render(<WebhooksManager orgId={ORG} initialSubscriptions={subscriptions} projects={PROJECTS} />);
  return { user };
}

const bodyRows = () => screen.getAllByRole('row').slice(1);
const nameInput = () => screen.getByRole('textbox', { name: /^Name/ });
const urlInput = () => screen.getByRole('textbox', { name: /^Address/ });

function created(secret = 'whsec_the_whole_secret') {
  return {
    subscription: row({ id: 'hook-new', name: 'Publish queue', url: 'https://q.example.com/in' }),
    secret,
  };
}

async function fillAndAdd(user: ReturnType<typeof userEvent.setup>) {
  await user.type(nameInput(), ' Publish queue ');
  await user.type(urlInput(), 'https://q.example.com/in');
  await user.click(screen.getByRole('button', { name: 'Add webhook' }));
}

beforeEach(() => {
  vi.mocked(apiClient.post).mockReset();
  vi.mocked(apiClient.patch).mockReset();
  vi.mocked(apiClient.delete).mockReset();
  vi.mocked(apiClient.get).mockReset();
});

describe('WebhooksManager', () => {
  describe('the list', () => {
    it('shows each webhook’s event, address, project, switch and last delivery', () => {
      setup([
        row({
          lastDelivery: {
            status: 'failed',
            attempts: 2,
            lastResponseCode: 503,
            createdAt: '2026-11-27T11:00:00.000Z',
          },
        }),
        row({
          id: 'hook-2',
          name: 'Comparisons',
          eventType: 'app.comparison.finished',
          projectId: PROJECTS[0].id,
          isEnabled: false,
        }),
        row({ id: 'hook-3', name: 'Old project', projectId: 'cmproj0000000000000gone1' }),
      ]);
      const [first, second, third] = bodyRows();
      expect(first).toHaveTextContent('CMS');
      expect(first).toHaveTextContent('Whole workspace');
      expect(first).toHaveTextContent('A review finishes');
      expect(first).toHaveTextContent('https://cms.example.com/hook');
      expect(first).toHaveTextContent('Failed, will retry');
      expect(within(first).getByRole('switch', { name: 'Send to CMS' })).toBeChecked();
      expect(second).toHaveTextContent('A comparison finishes');
      expect(second).toHaveTextContent('Spring launch');
      expect(second).toHaveTextContent('Nothing sent yet');
      expect(within(second).getByRole('switch')).not.toBeChecked();
      // Not among the live projects read: archived or past the first page, so neither is claimed.
      expect(third).toHaveTextContent('A project not listed here');
    });

    it('says so when there are none', () => {
      setup([]);
      expect(screen.getByText('No one has added a webhook here yet.')).toBeInTheDocument();
    });

    it('names delivery states as a person reads them', () => {
      expect(deliveryStatusLabel('pending')).toBe('Sending');
      expect(deliveryStatusLabel('delivered')).toBe('Delivered');
      expect(deliveryStatusLabel('exhausted')).toBe('Failed, gave up');
      expect(deliveryStatusLabel('something-new')).toBe('something-new');
      expect(deliveryStatusVariant('exhausted')).toBe('destructive');
      expect(deliveryStatusVariant('pending')).toBe('outline');
    });
  });

  describe('adding a webhook', () => {
    it('posts through the workspace’s route, shows the secret once, and it is gone once closed', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(created());
      const { user } = setup([]);

      await fillAndAdd(user);

      await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
      expect(apiClient.post).toHaveBeenCalledWith(BASE, {
        body: {
          name: 'Publish queue',
          eventType: 'app.assessment.finished',
          url: 'https://q.example.com/in',
        },
      });
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByTestId('webhook-secret')).toHaveTextContent(
        'whsec_the_whole_secret'
      );
      expect(dialog).toHaveTextContent('It won’t be shown again');
      expect(
        within(dialog).getByRole('link', { name: 'How to check a signature' })
      ).toHaveAttribute('href', '/developers#webhooks');

      await user.click(within(dialog).getByRole('button', { name: 'I’ve saved it' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.body).not.toHaveTextContent('whsec_the_whole_secret');
      const [added] = bodyRows();
      expect(added).toHaveTextContent('Publish queue');
      expect(added).toHaveTextContent('Nothing sent yet');
      expect(nameInput()).toHaveValue('');
      expect(urlInput()).toHaveValue('');
    });

    it('keeps the secret open through Escape and a click outside, so a stray press loses nothing', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(created());
      const { user } = setup([]);
      await fillAndAdd(user);
      await screen.findByRole('dialog');

      await user.keyboard('{Escape}');
      // The overlay sits outside the dialog's content: a press there is a click outside.
      const overlay = document.querySelector('[data-state="open"][class*="fixed inset-0"]');
      expect(overlay).not.toBeNull();
      await user.click(overlay as HTMLElement);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByTestId('webhook-secret')).toHaveTextContent('whsec_the_whole_secret');
      await user.click(screen.getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.body).not.toHaveTextContent('whsec_the_whole_secret');
    });

    it('sends the chosen event and project', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(created());
      const { user } = setup([]);
      await user.type(nameInput(), 'Launch');
      await user.type(urlInput(), 'https://q.example.com/in');
      await user.click(screen.getByRole('combobox', { name: /Send when/ }));
      await user.click(await screen.findByRole('option', { name: 'A comparison finishes' }));
      await user.click(screen.getByRole('combobox', { name: /Project/ }));
      await user.click(await screen.findByRole('option', { name: 'Spring launch' }));
      await user.click(screen.getByRole('button', { name: 'Add webhook' }));

      await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
      expect(vi.mocked(apiClient.post).mock.calls[0]?.[1]).toEqual({
        body: {
          name: 'Launch',
          eventType: 'app.comparison.finished',
          url: 'https://q.example.com/in',
          projectId: PROJECTS[0].id,
        },
      });
    });

    it('copies the secret and says so', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(created());
      const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
      const { user } = setup([]);
      await fillAndAdd(user);
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: /Copy secret/ }));
      expect(writeText).toHaveBeenCalledWith('whsec_the_whole_secret');
      expect(await within(dialog).findByText('Copied.')).toHaveAttribute('role', 'status');
    });

    it('blocks a missing name or a non-https address without calling the API', async () => {
      const { user } = setup([]);
      await user.type(urlInput(), 'http://insecure.example.com');
      await user.click(screen.getByRole('button', { name: 'Add webhook' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Give the webhook a name.');
      expect(alert).toHaveTextContent('starting https://');
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('shows the API’s refusal with SaveError and adds nothing', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        new APIClientError(
          'The address must be public, not a private network',
          'VALIDATION_ERROR',
          400
        )
      );
      const { user } = setup([]);
      await fillAndAdd(user);

      expect(await screen.findByRole('alert')).toHaveTextContent('must be public');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByText('No one has added a webhook here yet.')).toBeInTheDocument();
    });

    it('still shows the secret of one it made but cannot list, and says not to retry', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ secret: 'whsec_drifted', unexpected: true });
      const { user } = setup([]);
      await fillAndAdd(user);

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('whsec_drifted');
      await user.click(within(dialog).getByRole('button', { name: 'I’ve saved it' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('The webhook was added');
      expect(alert).not.toHaveTextContent('Try again');
    });

    it('offers no add at the workspace’s limit', () => {
      setup(
        Array.from({ length: MAX_SUBSCRIPTIONS_PER_WORKSPACE }, (_, i) =>
          row({ id: `hook-${i}`, name: `Hook ${i}` })
        )
      );
      expect(screen.getByRole('button', { name: 'Add webhook' })).toBeDisabled();
      expect(document.body).toHaveTextContent('Delete one to add another.');
    });
  });

  describe('switching one on or off', () => {
    it('patches only isEnabled and says what changed', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({ subscription: row({ isEnabled: false }) });
      const { user } = setup();
      await user.click(screen.getByRole('switch', { name: 'Send to CMS' }));

      await waitFor(() =>
        expect(apiClient.patch).toHaveBeenCalledWith(`${BASE}/hook-1`, {
          body: { isEnabled: false },
        })
      );
      expect(await screen.findByText('“CMS” is off.')).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: 'Send to CMS' })).not.toBeChecked();
    });

    it('keeps a switch disabled until its own request ends, whatever another one does', async () => {
      let finishFirst: (value: unknown) => void = () => {};
      vi.mocked(apiClient.patch)
        .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
        .mockImplementationOnce(() => new Promise(() => {}));
      const { user } = setup([row(), row({ id: 'hook-2', name: 'Second' })]);

      await user.click(screen.getByRole('switch', { name: 'Send to CMS' }));
      await user.click(screen.getByRole('switch', { name: 'Send to Second' }));
      finishFirst({ subscription: row({ isEnabled: false }) });

      expect(await screen.findByText('“CMS” is off.')).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: 'Send to CMS' })).toBeEnabled();
      expect(screen.getByRole('switch', { name: 'Send to Second' })).toBeDisabled();
    });

    it('leaves the switch as it was and shows the refusal when it fails', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue(
        new APIClientError('Switch to this workspace to manage its webhooks', 'FORBIDDEN', 403)
      );
      const { user } = setup();
      await user.click(screen.getByRole('switch', { name: 'Send to CMS' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Switch to this workspace');
      expect(screen.getByRole('switch', { name: 'Send to CMS' })).toBeChecked();
    });
  });

  describe('deleting one', () => {
    it('deletes after confirming and drops the row', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ deleted: true });
      const { user } = setup();
      await user.click(screen.getByRole('button', { name: 'Delete CMS' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog).toHaveTextContent('Delete “CMS”?');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith(`${BASE}/hook-1`));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(screen.getByText('No one has added a webhook here yet.')).toBeInTheDocument();
      expect(screen.getByText('Deleted “CMS”.')).toBeInTheDocument();
    });

    it('keeps the dialog open with the refusal inside when it fails', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        new APIClientError('Subscription not found', 'NOT_FOUND', 404)
      );
      const { user } = setup();
      await user.click(screen.getByRole('button', { name: 'Delete CMS' }));
      const dialog = await screen.findByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Subscription not found');
    });
  });

  describe('giving one a new secret', () => {
    it('rotates after confirming and shows the new secret once', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        id: 'hook-1',
        secret: 'whsec_rotated',
        rotatedAt: '2026-11-28T09:00:00.000Z',
      });
      const { user } = setup();
      await user.click(screen.getByRole('button', { name: 'New secret for CMS' }));
      const confirm = await screen.findByRole('alertdialog');
      await user.click(within(confirm).getByRole('button', { name: 'Make a new secret' }));

      await waitFor(() =>
        expect(apiClient.post).toHaveBeenCalledWith(`${BASE}/hook-1/rotate-secret`)
      );
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('New signing secret for “CMS”');
      expect(dialog).toHaveTextContent('whsec_rotated');
      expect(dialog).toHaveTextContent('accept both the old secret and this one for a minute');

      await user.click(within(dialog).getByRole('button', { name: 'I’ve saved it' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.body).not.toHaveTextContent('whsec_rotated');
    });

    it('shows a refusal inside the confirmation, with no secret', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        new APIClientError('Managing webhooks requires a browser session', 'FORBIDDEN', 403)
      );
      const { user } = setup();
      await user.click(screen.getByRole('button', { name: 'New secret for CMS' }));
      const confirm = await screen.findByRole('alertdialog');
      await user.click(within(confirm).getByRole('button', { name: 'Make a new secret' }));

      expect(await within(confirm).findByRole('alert')).toHaveTextContent('browser session');
      expect(screen.queryByTestId('webhook-secret')).toBeNull();
    });
  });

  describe('recent deliveries', () => {
    it('loads one webhook’s deliveries when opened, with status, attempts and response', async () => {
      vi.mocked(apiClient.get).mockResolvedValue([
        {
          id: 'd1',
          eventId: 'assessment:a1',
          status: 'delivered',
          attempts: 1,
          lastAttemptAt: '2026-11-27T11:00:01.000Z',
          nextRetryAt: null,
          lastResponseCode: 200,
          lastError: null,
          createdAt: '2026-11-27T11:00:00.000Z',
        },
        {
          id: 'd2',
          eventId: 'assessment:a2',
          status: 'exhausted',
          attempts: 4,
          lastAttemptAt: '2026-11-27T10:10:00.000Z',
          nextRetryAt: null,
          lastResponseCode: null,
          lastError: 'fetch failed',
          createdAt: '2026-11-27T10:00:00.000Z',
        },
      ]);
      const { user } = setup();
      expect(apiClient.get).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Deliveries of CMS' }));

      expect(apiClient.get).toHaveBeenCalledWith(`${BASE}/hook-1/deliveries`, {
        params: { limit: 10 },
      });
      const panel = await screen.findByText('The last 2 deliveries to “CMS”');
      const table = within(panel.parentElement!);
      expect(table.getByText('assessment:a1').closest('tr')).toHaveTextContent('Delivered');
      expect(table.getByText('assessment:a1').closest('tr')).toHaveTextContent('200');
      const failed = table.getByText('assessment:a2').closest('tr');
      expect(failed).toHaveTextContent('Failed, gave up');
      expect(failed).toHaveTextContent('4');
      expect(failed).toHaveTextContent('No answer: fetch failed');

      await user.click(screen.getByRole('button', { name: 'Hide deliveries of CMS' }));
      expect(screen.queryByText('The last 2 deliveries to “CMS”')).toBeNull();
    });

    it('shows the latest load, not an earlier one that answers after it', async () => {
      let finishFirst: (value: unknown) => void = () => {};
      vi.mocked(apiClient.get)
        .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
        .mockResolvedValueOnce([]);
      const { user } = setup();

      await user.click(screen.getByRole('button', { name: 'Deliveries of CMS' }));
      await user.click(screen.getByRole('button', { name: 'Hide deliveries of CMS' }));
      await user.click(screen.getByRole('button', { name: 'Deliveries of CMS' }));
      expect(await screen.findByText('Nothing has been sent to it yet.')).toBeInTheDocument();

      finishFirst([
        {
          id: 'old',
          eventId: 'assessment:stale',
          status: 'delivered',
          attempts: 1,
          lastAttemptAt: null,
          nextRetryAt: null,
          lastResponseCode: 200,
          lastError: null,
          createdAt: '2026-11-27T11:00:00.000Z',
        },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.queryByText('assessment:stale')).toBeNull();
      expect(screen.getByText('Nothing has been sent to it yet.')).toBeInTheDocument();
    });

    it('says when nothing has been sent, and offers a retry when the load fails', async () => {
      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('offline'));
      vi.mocked(apiClient.get).mockResolvedValueOnce([]);
      const { user } = setup();
      await user.click(screen.getByRole('button', { name: 'Deliveries of CMS' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('could not be loaded');
      await user.click(within(alert).getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Nothing has been sent to it yet.')).toBeInTheDocument();
    });
  });
});
