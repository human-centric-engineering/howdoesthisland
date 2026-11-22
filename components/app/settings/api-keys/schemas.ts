/**
 * The shapes the API-keys page reads from core's self-service key routes
 * (`/api/v1/user/api-keys`, t-43), validated rather than cast. Fields the page
 * does not use are left out; zod drops them.
 */
import { z } from 'zod';
import { APP_API_KEY_SCOPES } from '@/lib/app/api-key-scopes';

export const API_KEYS_ENDPOINT = '/api/v1/user/api-keys';
export const apiKeyEndpoint = (keyId: string): string =>
  `${API_KEYS_ENDPOINT}/${encodeURIComponent(keyId)}`;

/** Where the page lives; the settings link and the developer docs point here. */
export const API_KEYS_PAGE_HREF = '/settings/api-keys';

/** One row of `GET /api/v1/user/api-keys`. */
export const apiKeyRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  scopes: z.array(z.string()),
  /** `null` for a platform key (`admin` scope), which acts in no one workspace. */
  orgId: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type ApiKeyRow = z.infer<typeof apiKeyRowSchema>;

/** `GET /api/v1/user/api-keys` data. */
export const apiKeyListSchema = z.object({
  keys: z.array(apiKeyRowSchema),
  availableScopes: z.array(z.string()),
});

/** `POST /api/v1/user/api-keys` data: the new key, with its raw value shown once. */
export const mintedApiKeySchema = z.object({
  key: apiKeyRowSchema
    .pick({ id: true, name: true, keyPrefix: true, scopes: true, orgId: true, createdAt: true })
    .extend({ expiresAt: z.string().nullable(), rawKey: z.string() }),
});

/**
 * The least of a mint response that still lets the page show the new key's
 * value, for when the full shape above cannot be read: the key exists by then.
 */
export const mintedRawKeySchema = z.object({
  key: z.object({ name: z.string(), rawKey: z.string() }),
});

/**
 * What each of the app's scopes lets a key do, in the words the product uses.
 * Keyed by `APP_API_KEY_SCOPES`; a scope added there without a line here is
 * still offered, under its own name.
 */
export const SCOPE_DESCRIPTIONS: Readonly<Record<string, { label: string; detail: string }>> = {
  assess: {
    label: 'Run reviews',
    detail:
      'Run the AI reviewers on copy, read reviews, cancel and delete them, and make share links.',
  },
  reports: {
    label: 'Download and list reports',
    detail: "Download a review's report as a PDF, and list a review's share links.",
  },
  projects: {
    label: 'Manage projects',
    detail:
      "List, make and change the workspace's projects: their briefs and the defaults their reviews take. Running a review in a project needs Run reviews.",
  },
};

export function scopeLabel(scope: string): string {
  return SCOPE_DESCRIPTIONS[scope]?.label ?? scope;
}

/**
 * The scopes this page offers: the app's own, and only those the install says
 * it can mint. Core's `chat`, `analytics`, `knowledge` and `webhook` reach
 * nothing this product serves, and `admin` is a platform credential, so none
 * of them is offered here (least privilege, the seam's own argument, #542).
 */
export function offeredScopes(availableScopes: readonly string[]): string[] {
  return APP_API_KEY_SCOPES.filter((scope) => availableScopes.includes(scope));
}

/** How long a new key lasts. `null` days: until revoked. */
export const EXPIRY_CHOICES = [
  { value: '30', label: '30 days', days: 30 },
  { value: '90', label: '90 days', days: 90 },
  { value: '365', label: '1 year', days: 365 },
  { value: 'never', label: 'No expiry', days: null },
] as const;

export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number]['value'];

/** The `expiresAt` to send for a choice, from `now`; `undefined` for no expiry. */
export function expiresAtFor(choice: ExpiryChoice, now: Date): string | undefined {
  const days = EXPIRY_CHOICES.find((c) => c.value === choice)?.days ?? null;
  if (days === null) return undefined;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export type KeyState = 'active' | 'expired' | 'revoked';

export function keyState(key: Pick<ApiKeyRow, 'revokedAt' | 'expiresAt'>, now: Date): KeyState {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt && new Date(key.expiresAt) <= now) return 'expired';
  return 'active';
}
