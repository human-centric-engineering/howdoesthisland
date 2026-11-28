/**
 * One of the workspace's batches (t-101, `.context/app/batches.md`).
 *
 * GET    /api/v1/batches/{id} — its state, how many items are in each state,
 *        and each item's state, score, band, review id and, for one that
 *        failed with a code, the code. An item whose review was deleted or
 *        purged reads as `purged`.
 * DELETE /api/v1/batches/{id} — delete the batch; its items' reviews stay in
 *        the workspace's history, and any still running carry on.
 *
 * Authentication: a browser session, or an API key with the `assess` scope.
 *
 * Errors: 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (an API key without `assess`),
 * 404 `NOT_FOUND` (no such batch in this workspace; another workspace's id
 * reads the same).
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { assessRoute } from '@/lib/app/assessments/api/route-auth';
import { getBatch, removeBatch } from '@/lib/app/batches/service';
import { batchIdParamSchema } from '@/lib/app/batches/validations';

export const GET = withAuth<{ id: string }>(async (_request: NextRequest, _session, { params }) => {
  const { id } = validateQueryParams(new URLSearchParams(await params), batchIdParamSchema);
  return successResponse(await getBatch(id));
}, assessRoute<{ id: string }>());

export const DELETE = withAuth<{ id: string }>(
  async (_request: NextRequest, _session, { params }) => {
    const { id } = validateQueryParams(new URLSearchParams(await params), batchIdParamSchema);
    return successResponse(await removeBatch(id));
  },
  assessRoute<{ id: string }>()
);
