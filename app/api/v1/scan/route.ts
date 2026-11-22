/**
 * POST /api/v1/scan — the quick scan (t-24, t-61).
 *
 * Deterministic: no model is called, and nothing is stored. It needs no
 * workspace, because it reads only the framework tables, which are shared
 * config (readable anonymously at `TENANCY_MODE=multi`). Pasted text only: a
 * page or a file goes to `POST /api/v1/assessments` (D14).
 *
 * **Behind a switch** (`isQuickScanEnabled()`, `lib/app/quick-scan/switch.ts`): off,
 * the route answers 404 to everyone, as if it did not exist, and the OpenAPI
 * document and `/developers` leave it out. On by default (t-68).
 *
 * **Who may call it, and what they get** (t-68): anyone. A caller with no
 * account gets the scores and a caveat (`summariseQuickScan`): the overall
 * score, its band and each appeal's score, never the matched lines, which
 * would let anyone probe the model's patterns for free. A browser session or
 * an API key with the `assess` scope gets the full result, through `withAuth`
 * (so a key or session whose workspace is refused is refused here too). A
 * `code` in the body is accepted and ignored: a free review code is for a
 * full review, and the quick scan no longer needs one.
 *
 * Body: `{ text, framework?, version?, context?, code? }`
 * (`scanRequestSchema`). `framework` defaults to HowDoesThisLand and
 * `version` to its latest published one. `context` is checked against that
 * version's ids.
 *
 * Rate limiting: `SCANS_PER_MINUTE` per IP, by the `scan` rule in
 * `lib/app/rate-limit.ts`, whoever is calling.
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a body that is not JSON or does not fit the schema.
 * - 400 `CONTENT_EMPTY` — no text once trimmed.
 * - 400 `CONTEXT_INVALID` — the context names an id the version lacks; `details.issues` says which.
 * - 401 `ACCOUNT_REQUIRED` — the body asks for a page (`url`) or a file.
 * - 401 `UNAUTHORIZED` — an API key that is not valid.
 * - 403 `FORBIDDEN` — an API key without the `assess` scope, or a key or session
 *   whose workspace cannot be entered.
 * - 404 `NOT_FOUND` — the quick scan is switched off.
 * - 404 `FRAMEWORK_NOT_FOUND` — no such framework.
 * - 404 `FRAMEWORK_VERSION_NOT_FOUND` — no such published version.
 * - 422 `TEXT_TOO_LONG` — over 40,000 characters (refused, never truncated).
 * - 422 `NOT_SCORABLE` — the framework could not score the text.
 * - 429 `RATE_LIMIT_EXCEEDED` — over the per-IP cap.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleAPIError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { successResponse } from '@/lib/api/responses';
import { withAuth } from '@/lib/auth/guards';
import { ASSESS_SCOPE } from '@/lib/app/assessments/api/route-auth';
import { refuseAccountOnlyInput, runQuickScan } from '@/lib/app/assessments/api/scan';
import { scanRequestSchema } from '@/lib/app/assessments/api/validations';
import { presentsAccount } from '@/lib/app/quick-scan/access';
import { summariseQuickScan } from '@/lib/app/quick-scan/summary';
import { isQuickScanEnabled } from '@/lib/app/quick-scan/switch';

async function readJson(request: NextRequest): Promise<unknown> {
  return request.json().catch(() => {
    throw new ValidationError('Invalid JSON in request body');
  });
}

const bodyObject = z.record(z.string(), z.unknown());

/** The body without its `code`, which the quick scan does not read. */
function withoutCode(raw: unknown): unknown {
  const parsed = bodyObject.safeParse(raw);
  if (!parsed.success) return raw;
  const { code: _code, ...rest } = parsed.data;
  return rest;
}

/** Score the body: the full result for a member, the scores and a caveat for anyone else. */
async function scanBody(raw: unknown, full: boolean): Promise<Response> {
  refuseAccountOnlyInput(raw);
  const parsed = scanRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError('Invalid request body', {
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  // A free review code is for a full review; the quick scan ignores it.
  const { code: _code, ...scan } = parsed.data;
  const view = await runQuickScan(scan);
  return successResponse(full ? view : summariseQuickScan(view));
}

const scanAsMember = withAuth(
  async (request: NextRequest) => scanBody(withoutCode(await readJson(request)), true),
  {
    scope: ASSESS_SCOPE,
    ownership: {
      decidedBy: 'nothing',
      because:
        'The quick scan reads only the framework tables, which are shared config, and stores nothing.',
    },
  }
);

export async function POST(request: NextRequest): Promise<Response> {
  try {
    if (!isQuickScanEnabled()) throw new NotFoundError();
    if (await presentsAccount(request)) return await scanAsMember(request);
    return await scanBody(await readJson(request), false);
  } catch (error) {
    return handleAPIError(error);
  }
}
