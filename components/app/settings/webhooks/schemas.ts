/**
 * The shapes the webhooks page reads from
 * `/api/v1/workspaces/[id]/event-subscriptions` (t-99, t-100), validated
 * rather than cast, and the words it shows for events and delivery states.
 */
import { z } from 'zod';
import {
  APP_EVENT_TYPES,
  ASSESSMENT_FINISHED,
  COMPARISON_FINISHED,
  type AppEventType,
} from '@/lib/app/events/types';

export const WEBHOOKS_PAGE_HREF = '/settings/webhooks';

export const subscriptionsEndpoint = (orgId: string): string =>
  `/api/v1/workspaces/${encodeURIComponent(orgId)}/event-subscriptions`;

export const subscriptionEndpoint = (orgId: string, id: string): string =>
  `${subscriptionsEndpoint(orgId)}/${encodeURIComponent(id)}`;

export const rotateSecretEndpoint = (orgId: string, id: string): string =>
  `${subscriptionEndpoint(orgId, id)}/rotate-secret`;

export const deliveriesEndpoint = (orgId: string, id: string): string =>
  `${subscriptionEndpoint(orgId, id)}/deliveries`;

/** How many deliveries the page shows for one webhook. */
export const RECENT_DELIVERIES = 10;

const lastDeliverySchema = z.object({
  status: z.string(),
  attempts: z.number(),
  lastResponseCode: z.number().nullable(),
  createdAt: z.string(),
});

/** One webhook, as `EventSubscription` in `lib/app/events/subscriptions.ts` on the wire. */
export const subscriptionRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  eventType: z.enum(APP_EVENT_TYPES),
  url: z.string(),
  projectId: z.string().nullable(),
  isEnabled: z.boolean(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  /** Only the list carries it; a single read or a write answers without. */
  lastDelivery: lastDeliverySchema.nullable().optional(),
});

export type SubscriptionRow = z.infer<typeof subscriptionRowSchema>;

export const subscriptionListSchema = z.object({ subscriptions: z.array(subscriptionRowSchema) });

/** `POST …/event-subscriptions` data: the new webhook, and its secret once. */
export const createdSubscriptionSchema = z.object({
  subscription: subscriptionRowSchema,
  secret: z.string(),
});

/** The least of a create response that still shows the secret. */
export const createdSecretSchema = z.object({ secret: z.string() });

/** `PATCH …/{subscriptionId}` data. */
export const updatedSubscriptionSchema = z.object({ subscription: subscriptionRowSchema });

/** `POST …/rotate-secret` data. */
export const rotatedSecretSchema = z.object({ secret: z.string() });

/** One delivery, as `EventDelivery` on the wire. */
export const deliveryRowSchema = z.object({
  id: z.string(),
  eventId: z.string().nullable(),
  status: z.string(),
  attempts: z.number(),
  lastAttemptAt: z.string().nullable(),
  nextRetryAt: z.string().nullable(),
  lastResponseCode: z.number().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});

export type DeliveryRow = z.infer<typeof deliveryRowSchema>;

export const deliveryListSchema = z.array(deliveryRowSchema);

/** A project a webhook can be limited to: the least the page needs of `GET /api/v1/projects`. */
export const projectChoiceListSchema = z.array(z.object({ id: z.string(), name: z.string() }));

export type ProjectChoice = z.infer<typeof projectChoiceListSchema>[number];

/** What each event is, in the words people use (app-plan §4). */
export const EVENT_LABELS: Record<AppEventType, string> = {
  [ASSESSMENT_FINISHED]: 'A review finishes',
  [COMPARISON_FINISHED]: 'A comparison finishes',
};

/** Core's delivery states, as a person reads them. */
const DELIVERY_STATUS_LABELS: Record<string, string> = {
  pending: 'Sending',
  delivered: 'Delivered',
  failed: 'Failed, will retry',
  exhausted: 'Failed, gave up',
};

export function deliveryStatusLabel(status: string): string {
  return DELIVERY_STATUS_LABELS[status] ?? status;
}

/** The badge a delivery state takes: a failure stands out. */
export function deliveryStatusVariant(status: string): 'secondary' | 'outline' | 'destructive' {
  if (status === 'delivered') return 'secondary';
  if (status === 'failed' || status === 'exhausted') return 'destructive';
  return 'outline';
}
