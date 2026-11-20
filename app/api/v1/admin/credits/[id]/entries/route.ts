/**
 * POST /api/v1/admin/credits/{id}/entries — grant or adjust a workspace's
 * CopyCredits (t-57). Body: `{ kind: 'grant' | 'adjust', amount, reason }`.
 *
 * A grant gives credits (`amount` > 0). An adjustment corrects the balance
 * either way (`amount` ≠ 0) and may take it below zero. The caller is
 * recorded as the entry's actor, with the reason. Answers 201 with the entry,
 * the new balance and `capWarning` when that balance is worth more than the
 * workspace's monthly cap leaves this month (raise the cap on the workspace's
 * admin page if it should spend them now).
 *
 * Authentication: a platform admin (session, or an `admin` API key).
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a body that does not fit the schema.
 * - 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (not a platform admin).
 * - 404 `NOT_FOUND` — no such workspace, or one that is not active.
 */
import type { NextRequest } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { withAdminAuth } from '@/lib/auth/guards';
import { changeWorkspaceCredits } from '@/lib/app/credits/admin';
import { CREDITS_PLATFORM_ONLY } from '@/lib/app/credits/route-auth';
import { creditChangeSchema } from '@/lib/app/credits/wire';
import { orgIdParamSchema } from '@/lib/validations/tenancy';

export const POST = withAdminAuth<{ id: string }>(
  async (request: NextRequest, session, { params }) => {
    const parsed = orgIdParamSchema.safeParse(await params);
    if (!parsed.success) throw new NotFoundError('Workspace not found');
    const change = await validateRequestBody(request, creditChangeSchema);
    const result = await changeWorkspaceCredits(parsed.data.id, change, session.user.id);
    return successResponse(result, undefined, { status: 201 });
  },
  CREDITS_PLATFORM_ONLY
);
