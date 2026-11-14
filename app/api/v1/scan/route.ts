/**
 * POST /api/v1/scan — the free quick scan (t-24, D7).
 *
 * Deterministic: no model is called, and nothing is stored. Anyone may call
 * it, signed in or not; it needs no workspace, because it reads only the
 * framework tables, which are shared config (readable anonymously at
 * `TENANCY_MODE=multi`). Pasted text only: a page or a file needs an account
 * (D14) and goes to `POST /api/v1/assessments`.
 *
 * Body: `{ text, framework?, version?, context? }` (`scanRequestSchema`).
 * `framework` defaults to HowDoesThisLand and `version` to its latest
 * published one. `context` is checked against that version's ids.
 *
 * Rate limiting: `SCANS_PER_MINUTE` per IP, by the `scan` rule in
 * `lib/app/rate-limit.ts`, whoever is calling.
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a body that is not JSON or does not fit the schema.
 * - 400 `CONTENT_EMPTY` — no text once trimmed.
 * - 400 `CONTEXT_INVALID` — the context names an id the version lacks; `details.issues` says which.
 * - 401 `ACCOUNT_REQUIRED` — the body asks for a page (`url`) or a file.
 * - 404 `FRAMEWORK_NOT_FOUND` — no such framework.
 * - 404 `FRAMEWORK_VERSION_NOT_FOUND` — no such published version.
 * - 422 `TEXT_TOO_LONG` — over 40,000 characters (refused, never truncated).
 * - 429 `RATE_LIMIT_EXCEEDED` — over the per-IP cap.
 */
import type { NextRequest } from 'next/server';
import { handleAPIError } from '@/lib/api/errors';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { refuseAccountOnlyInput, runQuickScan } from '@/lib/app/assessments/api/scan';
import { scanRequestSchema } from '@/lib/app/assessments/api/validations';

export async function POST(request: NextRequest): Promise<Response> {
  try {
    // A body that is not JSON is the schema's to answer, below.
    refuseAccountOnlyInput(
      await request
        .clone()
        .json()
        .catch(() => null)
    );
    const body = await validateRequestBody(request, scanRequestSchema);
    return successResponse(await runQuickScan(body));
  } catch (error) {
    return handleAPIError(error);
  }
}
