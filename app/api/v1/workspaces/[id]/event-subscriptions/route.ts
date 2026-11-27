/**
 * A workspace's webhook subscriptions (t-99, `.context/app/webhooks.md`)
 *
 * GET  /api/v1/workspaces/[id]/event-subscriptions — the workspace's
 *   subscriptions, newest first. Never a secret or a header's value.
 * POST /api/v1/workspaces/[id]/event-subscriptions — `{ name, eventType, url,
 *   headers?, projectId?, isEnabled? }`. Subscribes an `https://` address to
 *   one of the app's events (`app.assessment.finished`,
 *   `app.comparison.finished`). Every delivery is signed; the secret is
 *   answered once (`secret`) and cannot be read again.
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a missing name, an event that is not the app's,
 *   an address that is not `https://` or not public, a reserved or malformed
 *   header, a project not in this workspace, or a field this route does not take.
 * - 400 `WORKSPACES_UNAVAILABLE` — `TENANCY_MODE=single`.
 * - 401 `UNAUTHORIZED` — no session.
 * - 403 `FORBIDDEN` — an API key, a `MEMBER`, someone outside the workspace,
 *   a caller acting in another workspace, or (on `POST`) a support session.
 * - 409 `SUBSCRIPTION_LIMIT` — the workspace already has the most it may.
 *
 * Who may call it is the authorization policy's: the workspace's `OWNER` or
 * `ADMIN` while acting in it, or a platform admin who has entered it
 * (`lib/app/events/route-access.ts`).
 */
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { orgIdParamSchema } from '@/lib/validations/tenancy';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import {
  createSubscription,
  createSubscriptionSchema,
  listSubscriptions,
} from '@/lib/app/events/subscriptions';
import {
  EVENT_SUBSCRIPTIONS_RESOURCE,
  refuseEventSubscriptionsRequest,
  requireEnteredWorkspace,
} from '@/lib/app/events/route-access';

export const GET = withAuth<{ id: string }>(async (_request, session, { params }) => {
  const refused = refuseEventSubscriptionsRequest(session);
  if (refused) return refused;
  const { id } = validateQueryParams(new URLSearchParams(await params), orgIdParamSchema);
  requireEnteredWorkspace(id);
  return successResponse({ subscriptions: await listSubscriptions(id) });
}, EVENT_SUBSCRIPTIONS_RESOURCE);

export const POST = withAuth<{ id: string }>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);
  const refused = refuseEventSubscriptionsRequest(session);
  if (refused) return refused;
  const { id } = validateQueryParams(new URLSearchParams(await params), orgIdParamSchema);
  requireEnteredWorkspace(id);
  const body = await validateRequestBody(request, createSubscriptionSchema);

  const { subscription, secret } = await createSubscription({
    orgId: id,
    createdBy: session.user.id,
    body,
  });

  log.info('Workspace webhook created', {
    orgId: id,
    subscriptionId: subscription.id,
    eventType: subscription.eventType,
    userId: session.user.id,
  });
  logAdminAction({
    userId: session.user.id,
    action: 'hook.create',
    entityType: 'hook',
    entityId: subscription.id,
    entityName: subscription.name,
    metadata: { eventType: subscription.eventType, workspaceWebhook: true },
    clientIp: getClientIP(request),
  });
  return successResponse({ subscription, secret }, undefined, { status: 201 });
}, EVENT_SUBSCRIPTIONS_RESOURCE);
