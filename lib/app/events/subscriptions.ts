/**
 * A workspace's webhook subscriptions (t-99, `.context/app/webhooks.md`):
 * a URL that is sent, signed, each of the workspace's finished events of one
 * kind.
 *
 * **A subscription is a core event hook** (`AiEventHook`) in the workspace's
 * org. Core signs, sends, retries and records each delivery, and caches hooks
 * per org, so the app adds no model and no sender. Core's own hook routes
 * (`/api/v1/admin/orchestration/hooks`) are for platform admins, the secret
 * rotation among them, so a workspace's owners and admins come through here:
 * the same rules as core's routes, built on its exported helpers, unedited.
 *
 * **Only the app's events.** A subscription's event is one of
 * {@link APP_EVENT_TYPES}, never core's, and every read and write names one,
 * so a hook a platform admin made in the same org for a core event is never
 * listed, changed or deleted here.
 *
 * **The secret is a credential.** It is made with the subscription and shown
 * once, then again only by rotating it; reads say only `hasSecret`. Making or
 * rotating one goes through `orgForMint`, which refuses a support session: a
 * platform admin entering under a grant must not leave a credential behind.
 * Header values are never read back either, only their names.
 *
 * Every query names the workspace as well as the row's id, so another
 * workspace's subscription reads as not found even where row isolation is
 * not enabled.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { APIError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { invalidateHookCache } from '@/lib/orchestration/hooks/registry';
import { generateHookSecret } from '@/lib/orchestration/hooks/signing';
import { RESERVED_HEADER_ERROR, hasReservedHookHeader } from '@/lib/orchestration/hooks/types';
import { isSafeProviderUrl } from '@/lib/security/safe-url';
import { cuidSchema } from '@/lib/validations/common';
import { orgIdParamSchema } from '@/lib/validations/tenancy';
import { orgForMint } from '@/lib/tenancy/entry';
import {
  APP_EVENT_TYPES,
  MAX_SUBSCRIPTIONS_PER_WORKSPACE,
  MAX_SUBSCRIPTION_HEADERS,
} from '@/lib/app/events/types';

// --- Schemas ----------------------------------------------------------------

const urlField = z
  .url('Give a full address, starting https://')
  .max(2048)
  .refine((url) => url.startsWith('https://'), 'The address must start https://')
  .refine((url) => isSafeProviderUrl(url), 'The address must be public, not a private network');

/**
 * Header names `fetch` (undici) refuses to send or manages itself, so a hook
 * carrying one would fail every delivery, and the one core sends the event
 * type in.
 */
const FORBIDDEN_HEADER_NAMES = new Set([
  'connection',
  'content-length',
  'content-type',
  'expect',
  'host',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  // Core sends the event type in it; one stored here would replace it.
  'x-hook-event',
]);

/**
 * A header name as HTTP allows it (a token), and a value of visible Latin-1
 * plus space and tab, which is what `fetch` will send. Names compared ignoring
 * case, as HTTP does: two that differ only in case would be merged into one.
 */
const headersField = z
  .record(
    z
      .string()
      .min(1)
      .max(100)
      .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, 'Not a valid header name')
      .refine((name) => !FORBIDDEN_HEADER_NAMES.has(name.toLowerCase()), {
        error: 'This header is set by the sender and cannot be given',
      }),
    z
      .string()
      .max(1000)
      .regex(
        /^[\t\x20-\x7e\x80-\xff]*$/,
        'A header value can hold only printable characters, with no line breaks'
      )
  )
  .refine((h) => Object.keys(h).length <= MAX_SUBSCRIPTION_HEADERS, {
    error: `At most ${MAX_SUBSCRIPTION_HEADERS} headers`,
  })
  .refine(
    (h) => new Set(Object.keys(h).map((k) => k.toLowerCase())).size === Object.keys(h).length,
    { error: 'Two headers have the same name' }
  )
  .refine((h) => !hasReservedHookHeader(h), RESERVED_HEADER_ERROR);

/** Body of `POST /api/v1/workspaces/{id}/event-subscriptions`. */
export const createSubscriptionSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the subscription a name').max(100),
    eventType: z.enum(APP_EVENT_TYPES),
    url: urlField,
    /** Sent with every delivery, e.g. a receiver's own token. Never read back. */
    headers: headersField.optional(),
    /** Only work in this project. Left out or `null`: the whole workspace's. */
    projectId: cuidSchema.nullable().optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict();

/**
 * Body of `PATCH …/event-subscriptions/{subscriptionId}`. `headers` replaces
 * them all, and must come with a new `url`.
 */
export const updateSubscriptionSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the subscription a name').max(100).optional(),
    eventType: z.enum(APP_EVENT_TYPES).optional(),
    url: urlField.optional(),
    headers: headersField.optional(),
    projectId: cuidSchema.nullable().optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { error: 'Give at least one field to change' })
  // A header value can be the receiver's credential, and it is never read
  // back: carried over to a new address, it would be sent to someone the
  // admin who set it never chose. So a new address takes its headers afresh.
  .refine((body) => body.url === undefined || body.headers !== undefined, {
    error: 'A new address needs its headers sent again: give `headers` too, or `{}` for none',
    path: ['headers'],
  });

export type CreateSubscription = z.infer<typeof createSubscriptionSchema>;
export type UpdateSubscription = z.infer<typeof updateSubscriptionSchema>;

/** `[subscriptionId]` of `…/event-subscriptions/[subscriptionId]`, with the workspace's `id`. */
export const subscriptionParamsSchema = orgIdParamSchema.extend({ subscriptionId: cuidSchema });

/** Query of `GET …/{subscriptionId}/deliveries`. */
export const listDeliveriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['pending', 'delivered', 'failed', 'exhausted']).optional(),
});

// --- Views ------------------------------------------------------------------

/** One subscription as the workspace sees it. Never its secret or header values. */
export interface EventSubscription {
  id: string;
  name: string;
  eventType: (typeof APP_EVENT_TYPES)[number];
  url: string;
  /** The custom headers it sends, by name. */
  headerNames: string[];
  projectId: string | null;
  isEnabled: boolean;
  /** Whether deliveries are signed. Always `true` for one made here. */
  hasSecret: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Who made it; `null` once their account is deleted. */
  createdByName: string | null;
}

/** One delivery of a subscription's events, as core recorded it. */
export interface EventDelivery {
  id: string;
  eventType: string;
  /** The event's id from its payload (`assessment:<id>`), for matching what the receiver logged. */
  eventId: string | null;
  status: string;
  attempts: number;
  lastAttemptAt: Date | null;
  nextRetryAt: Date | null;
  lastResponseCode: number | null;
  lastError: string | null;
  createdAt: Date;
}

const HOOK_SELECT = {
  id: true,
  name: true,
  eventType: true,
  action: true,
  filter: true,
  isEnabled: true,
  secret: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { name: true } },
} satisfies Prisma.AiEventHookSelect;

type HookRow = Prisma.AiEventHookGetPayload<{ select: typeof HOOK_SELECT }>;

const storedAction = z.object({
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});
const storedFilter = z.object({ projectId: z.string().nullable().optional() }).loose();

function toView(row: HookRow): EventSubscription {
  const eventType = z.enum(APP_EVENT_TYPES).parse(row.eventType);
  const action = storedAction.safeParse(row.action);
  const filter = storedFilter.safeParse(row.filter ?? {});
  return {
    id: row.id,
    name: row.name,
    eventType,
    url: action.success ? action.data.url : '',
    headerNames: action.success ? Object.keys(action.data.headers ?? {}) : [],
    projectId: filter.success ? (filter.data.projectId ?? null) : null,
    isEnabled: row.isEnabled,
    hasSecret: row.secret !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdByName: row.creator?.name ?? null,
  };
}

/** The rows this module may touch: the workspace's, for one of the app's events. */
const ours = (orgId: string, id?: string): Prisma.AiEventHookWhereInput => ({
  ...(id ? { id } : {}),
  orgId,
  eventType: { in: [...APP_EVENT_TYPES] },
});

// --- Reads ------------------------------------------------------------------

/** The workspace's subscriptions, newest first. */
export async function listSubscriptions(orgId: string): Promise<EventSubscription[]> {
  const rows = await prisma.aiEventHook.findMany({
    where: ours(orgId),
    orderBy: { createdAt: 'desc' },
    select: HOOK_SELECT,
  });
  return rows.map(toView);
}

/** One of the workspace's subscriptions. Another workspace's, or none, is not found. */
export async function getSubscription(orgId: string, id: string): Promise<EventSubscription> {
  return toView(await findOurs(orgId, id));
}

async function findOurs(orgId: string, id: string): Promise<HookRow> {
  const row = await prisma.aiEventHook.findFirst({ where: ours(orgId, id), select: HOOK_SELECT });
  if (!row) throw new NotFoundError('Subscription not found');
  return row;
}

const eventIdOf = z.object({ data: z.object({ eventId: z.string() }) });

/** A page of one subscription's deliveries, newest first. */
export async function listDeliveries(
  orgId: string,
  id: string,
  query: z.infer<typeof listDeliveriesQuerySchema>
): Promise<{ items: EventDelivery[]; total: number }> {
  await findOurs(orgId, id);
  const where: Prisma.AiEventHookDeliveryWhereInput = {
    orgId,
    hookId: id,
    ...(query.status ? { status: query.status } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.aiEventHookDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        eventType: true,
        payload: true,
        status: true,
        attempts: true,
        lastAttemptAt: true,
        nextRetryAt: true,
        lastResponseCode: true,
        lastError: true,
        createdAt: true,
      },
    }),
    prisma.aiEventHookDelivery.count({ where }),
  ]);
  return {
    items: rows.map(({ payload, ...row }) => {
      const parsed = eventIdOf.safeParse(payload);
      return { ...row, eventId: parsed.success ? parsed.data.data.eventId : null };
    }),
    total,
  };
}

// --- Writes -----------------------------------------------------------------

/**
 * A hook with no filter: core matches every event of its type when the
 * filter has no keys, as it does for none (`matchesFilter`). An empty object
 * rather than SQL `NULL`, which needs `Prisma.DbNull`, a value `lib/app`
 * may not import.
 */
const NO_FILTER = {};

/** Refuse unless the project is the workspace's. */
async function requireProject(orgId: string, projectId: string | null | undefined): Promise<void> {
  if (!projectId) return;
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: { archivedAt: true },
  });
  if (!project) {
    throw new ValidationError('No such project in this workspace', {
      projectId: ['Not a project in this workspace'],
    });
  }
  // An archived project takes no new reviews, so a webhook scoped to it
  // would never fire.
  if (project.archivedAt !== null) {
    throw new ValidationError('That project is archived', {
      projectId: ['An archived project has no new work to send'],
    });
  }
}

/** The org the request may make a credential in, which must be the workspace the route resolved. */
function mintOrgFor(orgId: string): string {
  const mintOrg = orgForMint();
  if (mintOrg !== orgId) {
    // The route requires the entered workspace first; this is the backstop.
    throw new ForbiddenError('Switch to this workspace to manage its webhooks');
  }
  return mintOrg;
}

/**
 * Make a subscription, signed from the start. Answers its secret once.
 * Refused (409 `SUBSCRIPTION_LIMIT`) past {@link MAX_SUBSCRIPTIONS_PER_WORKSPACE}.
 */
export async function createSubscription(input: {
  orgId: string;
  createdBy: string;
  body: CreateSubscription;
}): Promise<{ subscription: EventSubscription; secret: string }> {
  const orgId = mintOrgFor(input.orgId);
  const { body } = input;
  await requireProject(orgId, body.projectId);
  const secret = generateHookSecret();

  const row = await prisma.$transaction(async (tx) => {
    // One writer at a time per workspace, so two creates at once cannot both
    // pass the count.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`app-event-subscriptions:${orgId}`}))`;
    const count = await tx.aiEventHook.count({ where: ours(orgId) });
    if (count >= MAX_SUBSCRIPTIONS_PER_WORKSPACE) {
      throw new APIError(
        `A workspace can have at most ${MAX_SUBSCRIPTIONS_PER_WORKSPACE} webhooks. Delete one first.`,
        'SUBSCRIPTION_LIMIT',
        409,
        { limit: MAX_SUBSCRIPTIONS_PER_WORKSPACE }
      );
    }
    return tx.aiEventHook.create({
      data: {
        name: body.name,
        eventType: body.eventType,
        action: {
          type: 'webhook',
          url: body.url,
          ...(body.headers ? { headers: body.headers } : {}),
        },
        filter: body.projectId ? { projectId: body.projectId } : NO_FILTER,
        isEnabled: body.isEnabled ?? true,
        secret,
        createdBy: input.createdBy,
        orgId,
      },
      select: HOOK_SELECT,
    });
  });
  invalidateHookCache();
  return { subscription: toView(row), secret };
}

/** Change a subscription. Answers it as it now is, and what changed (field names only). */
export async function updateSubscription(
  orgId: string,
  id: string,
  body: UpdateSubscription
): Promise<{ subscription: EventSubscription; changed: string[] }> {
  // A change outlives the session that made it: where the workspace's
  // finished work is sent, and with what, is the credential's to decide, so a
  // support session may not change it any more than make one (`orgForMint`).
  mintOrgFor(orgId);
  const existing = await findOurs(orgId, id);
  if (body.projectId !== undefined) await requireProject(orgId, body.projectId);
  const action = storedAction.parse(existing.action);

  const data: Prisma.AiEventHookUpdateManyMutationInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.eventType !== undefined) data.eventType = body.eventType;
  if (body.isEnabled !== undefined) data.isEnabled = body.isEnabled;
  if (body.url !== undefined || body.headers !== undefined) {
    // A new address always comes with its headers (the schema), so stored
    // ones are kept only for the address they were set for.
    const headers = body.headers ?? action.headers;
    data.action = {
      type: 'webhook',
      url: body.url ?? action.url,
      ...(headers ? { headers } : {}),
    };
  }
  if (body.projectId !== undefined) {
    data.filter = body.projectId ? { projectId: body.projectId } : NO_FILTER;
  }

  // Named by the workspace and the app's events again, so a row moved or
  // deleted since the read is not written.
  const { count } = await prisma.aiEventHook.updateMany({
    where: ours(orgId, id),
    data,
  });
  if (count === 0) throw new NotFoundError('Subscription not found');
  invalidateHookCache();
  return { subscription: await getSubscription(orgId, id), changed: Object.keys(body) };
}

/** Delete a subscription. Its deliveries stay, as core keeps them, as the record of what was sent. */
export async function deleteSubscription(orgId: string, id: string): Promise<{ name: string }> {
  const existing = await findOurs(orgId, id);
  const { count } = await prisma.aiEventHook.deleteMany({ where: ours(orgId, id) });
  if (count === 0) throw new NotFoundError('Subscription not found');
  invalidateHookCache();
  return { name: existing.name };
}

/**
 * Give a subscription a new secret. Answers it once. Each server signs with
 * it once its hook cache next loads, within a minute (core caches hooks per
 * process for 60 seconds), so a receiver should accept both secrets for a
 * minute while it switches over.
 */
export async function rotateSubscriptionSecret(
  orgId: string,
  id: string
): Promise<{ id: string; name: string; secret: string; rotatedAt: Date; hadPrevious: boolean }> {
  mintOrgFor(orgId);
  const existing = await findOurs(orgId, id);
  const secret = generateHookSecret();
  const { count } = await prisma.aiEventHook.updateMany({
    where: ours(orgId, id),
    data: { secret },
  });
  if (count === 0) throw new NotFoundError('Subscription not found');
  invalidateHookCache();
  const now = await prisma.aiEventHook.findFirst({
    where: ours(orgId, id),
    select: { updatedAt: true },
  });
  return {
    id,
    name: existing.name,
    secret,
    rotatedAt: now?.updatedAt ?? new Date(),
    hadPrevious: existing.secret !== null,
  };
}
