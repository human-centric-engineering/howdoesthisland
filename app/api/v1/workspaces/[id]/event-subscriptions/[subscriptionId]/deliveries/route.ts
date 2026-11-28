/**
 * A workspace webhook's deliveries (t-99, `.context/app/webhooks.md`)
 *
 * GET …/event-subscriptions/[subscriptionId]/deliveries — newest first, as
 *   core recorded them: status (`pending`, `delivered`, `failed`,
 *   `exhausted`), attempts, the receiver's last response code and error, and
 *   the event's `eventId`. `page`, `limit` (at most 50), `status`.
 *
 * Errors: as the subscription route.
 */
import { withAuth } from '@/lib/auth/guards';
import { paginatedResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import {
  listDeliveries,
  listDeliveriesQuerySchema,
  subscriptionParamsSchema,
} from '@/lib/app/events/subscriptions';
import {
  EVENT_SUBSCRIPTIONS_RESOURCE,
  refuseEventSubscriptionsRequest,
  requireEnteredWorkspace,
} from '@/lib/app/events/route-access';

export const GET = withAuth<{ id: string; subscriptionId: string }>(
  async (request, session, { params }) => {
    const refused = refuseEventSubscriptionsRequest(session);
    if (refused) return refused;
    const { id, subscriptionId } = validateQueryParams(
      new URLSearchParams(await params),
      subscriptionParamsSchema
    );
    requireEnteredWorkspace(id);
    const query = validateQueryParams(new URL(request.url).searchParams, listDeliveriesQuerySchema);
    const { items, total } = await listDeliveries(id, subscriptionId, query);
    return paginatedResponse(items, { page: query.page, limit: query.limit, total });
  },
  EVENT_SUBSCRIPTIONS_RESOURCE
);
