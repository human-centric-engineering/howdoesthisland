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
import { handleAPIError, ValidationError } from '@/lib/api/errors';
import { successResponse } from '@/lib/api/responses';
import { refuseAccountOnlyInput, runQuickScan } from '@/lib/app/assessments/api/scan';
import { scanRequestSchema } from '@/lib/app/assessments/api/validations';

export async function POST(request: NextRequest): Promise<Response> {
  try {
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
    return successResponse(await runQuickScan(parsed.data));
  } catch (error) {
    return handleAPIError(error);
  }
}
