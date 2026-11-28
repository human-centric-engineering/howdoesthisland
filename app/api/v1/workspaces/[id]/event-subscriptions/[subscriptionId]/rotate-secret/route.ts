/**
 * Give a workspace webhook a new signing secret (t-99, `.context/app/webhooks.md`)
 *
 * POST …/event-subscriptions/[subscriptionId]/rotate-secret — answers
 *   `{ id, secret, rotatedAt }`, the secret once. Deliveries are signed with
 *   it from the next send on.
 *
 * Core's own rotate route (`/api/v1/admin/orchestration/hooks/{id}/rotate-secret`)
 * is for platform admins; this is the workspace's, on core's helpers.
 *
 * Errors: as the subscription route, and 403 `FORBIDDEN` for a support session.
 */
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { rotateSubscriptionSecret, subscriptionParamsSchema } from '@/lib/app/events/subscriptions';
import {
  EVENT_SUBSCRIPTIONS_RESOURCE,
  refuseEventSubscriptionsRequest,
  requireEnteredWorkspace,
} from '@/lib/app/events/route-access';

export const POST = withAuth<{ id: string; subscriptionId: string }>(
  async (request, session, { params }) => {
    const log = await getRouteLogger(request);
    const refused = refuseEventSubscriptionsRequest(session);
    if (refused) return refused;
    const { id, subscriptionId } = validateQueryParams(
      new URLSearchParams(await params),
      subscriptionParamsSchema
    );
    requireEnteredWorkspace(id);

    const rotated = await rotateSubscriptionSecret(id, subscriptionId);
    log.info('Workspace webhook secret rotated', {
      orgId: id,
      subscriptionId,
      hadPrevious: rotated.hadPrevious,
      userId: session.user.id,
    });
    logAdminAction({
      userId: session.user.id,
      action: 'hook.secret.rotated',
      entityType: 'hook',
      entityId: subscriptionId,
      entityName: rotated.name,
      metadata: { hadPrevious: rotated.hadPrevious, workspaceWebhook: true },
      clientIp: getClientIP(request),
    });
    return successResponse({
      id: rotated.id,
      secret: rotated.secret,
      rotatedAt: rotated.rotatedAt,
    });
  },
  EVENT_SUBSCRIPTIONS_RESOURCE
);
