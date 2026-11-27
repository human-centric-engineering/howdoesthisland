/**
 * One of a workspace's webhook subscriptions (t-99, `.context/app/webhooks.md`)
 *
 * GET    …/event-subscriptions/[subscriptionId] — the subscription.
 * PATCH  …/event-subscriptions/[subscriptionId] — any of `{ name, eventType,
 *   url, headers, projectId, isEnabled }`. `headers` replaces them all, and a
 *   new `url` must bring its `headers` (`{}` for none), so a stored header
 *   value is never sent to an address its setter did not choose;
 *   `projectId: null` widens it to the whole workspace.
 * DELETE …/event-subscriptions/[subscriptionId] — stops it. Its deliveries are
 *   kept, as the record of what was sent.
 *
 * Errors: as the collection route; 404 `NOT_FOUND` for a subscription that
 * is not this workspace's, or not one of the app's events; and 403
 * `FORBIDDEN` for a `PATCH` in a support session, since the change outlives it.
 */
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import {
  deleteSubscription,
  getSubscription,
  subscriptionParamsSchema,
  updateSubscription,
  updateSubscriptionSchema,
} from '@/lib/app/events/subscriptions';
import {
  EVENT_SUBSCRIPTIONS_RESOURCE,
  refuseEventSubscriptionsRequest,
  requireEnteredWorkspace,
} from '@/lib/app/events/route-access';

type Params = { id: string; subscriptionId: string };

async function parse(params: Promise<Params>) {
  const parsed = validateQueryParams(new URLSearchParams(await params), subscriptionParamsSchema);
  requireEnteredWorkspace(parsed.id);
  return parsed;
}

export const GET = withAuth<Params>(async (_request, session, { params }) => {
  const refused = refuseEventSubscriptionsRequest(session);
  if (refused) return refused;
  const { id, subscriptionId } = await parse(params);
  return successResponse({ subscription: await getSubscription(id, subscriptionId) });
}, EVENT_SUBSCRIPTIONS_RESOURCE);

export const PATCH = withAuth<Params>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);
  const refused = refuseEventSubscriptionsRequest(session);
  if (refused) return refused;
  const { id, subscriptionId } = await parse(params);
  const body = await validateRequestBody(request, updateSubscriptionSchema);

  const { subscription, changed } = await updateSubscription(id, subscriptionId, body);
  log.info('Workspace webhook updated', {
    orgId: id,
    subscriptionId,
    changed,
    userId: session.user.id,
  });
  logAdminAction({
    userId: session.user.id,
    action: 'hook.update',
    entityType: 'hook',
    entityId: subscriptionId,
    entityName: subscription.name,
    // Field names only: a header's value can be the receiver's credential.
    metadata: { changed, workspaceWebhook: true },
    clientIp: getClientIP(request),
  });
  return successResponse({ subscription });
}, EVENT_SUBSCRIPTIONS_RESOURCE);

export const DELETE = withAuth<Params>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);
  const refused = refuseEventSubscriptionsRequest(session);
  if (refused) return refused;
  const { id, subscriptionId } = await parse(params);

  const { name } = await deleteSubscription(id, subscriptionId);
  log.info('Workspace webhook deleted', { orgId: id, subscriptionId, userId: session.user.id });
  logAdminAction({
    userId: session.user.id,
    action: 'hook.delete',
    entityType: 'hook',
    entityId: subscriptionId,
    entityName: name,
    metadata: { workspaceWebhook: true },
    clientIp: getClientIP(request),
  });
  return successResponse({ deleted: true });
}, EVENT_SUBSCRIPTIONS_RESOURCE);
