/**
 * POST /api/v1/scan — the quick scan (t-24, t-61).
 *
 * Deterministic: no model is called, and nothing is stored. It needs no
 * workspace, because it reads only the framework tables, which are shared
 * config (readable anonymously at `TENANCY_MODE=multi`). Pasted text only: a
 * page or a file goes to `POST /api/v1/assessments` (D14).
 *
 * **Behind a switch** (`isQuickScanEnabled()`, `lib/app/quick-scan.ts`): off,
 * the route answers 404 to everyone, as if it did not exist, and the OpenAPI
 * document and `/developers` leave it out. Off by default in production.
 *
 * **Who may call it:** a browser session, an API key with the `assess`
 * scope, or a caller sending a free review code (`code`) that has not
 * expired, been withdrawn or run out. The code is checked, never used up.
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
 * - 401 `ACCOUNT_REQUIRED` — the body asks for a page (`url`) or a file; or there is no
 *   session, no API key and no code that could be redeemed.
 * - 403 `FORBIDDEN` — an API key without the `assess` scope.
 * - 404 `NOT_FOUND` — the quick scan is switched off.
 * - 404 `FRAMEWORK_NOT_FOUND` — no such framework.
 * - 404 `FRAMEWORK_VERSION_NOT_FOUND` — no such published version.
 * - 422 `TEXT_TOO_LONG` — over 40,000 characters (refused, never truncated).
 * - 422 `NOT_SCORABLE` — the framework could not score the text.
 * - 429 `RATE_LIMIT_EXCEEDED` — over the per-IP cap.
 */
import type { NextRequest } from 'next/server';
import { handleAPIError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { successResponse } from '@/lib/api/responses';
import { refuseAccountOnlyInput, runQuickScan } from '@/lib/app/assessments/api/scan';
import { scanRequestSchema } from '@/lib/app/assessments/api/validations';
import { admitQuickScan, isQuickScanEnabled } from '@/lib/app/quick-scan';

export async function POST(request: NextRequest): Promise<Response> {
  try {
    if (!isQuickScanEnabled()) throw new NotFoundError();
    // Read once: the account-only check and the schema both use it.
    const raw: unknown = await request.json().catch(() => {
      throw new ValidationError('Invalid JSON in request body');
    });
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
    const { code, ...scan } = parsed.data;
    await admitQuickScan(request, code);
    return successResponse(await runQuickScan(scan));
  } catch (error) {
    return handleAPIError(error);
  }
}
