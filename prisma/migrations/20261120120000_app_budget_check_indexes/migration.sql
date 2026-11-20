-- t-54: indexes for the budget check's reads (lib/app/usage/budget.ts), which
-- run on every non-quick review request, before the per-user limiter:
--   - a profile's recent completed reviews: (orgId, profile, status) newest first;
--   - the workspace's recent completed reviews and its reviews in flight:
--     (orgId, status) newest first;
--   - its recent succeeded judge runs: (orgId, status) newest first, which
--     `JudgeRun`'s only org index, (orgId), made a read and sort of every run
--     the workspace ever had.
-- Each replaced index is a leading prefix of its replacement, so every read
-- it served is still served.
--
-- Generated with `prisma migrate diff` from the previous schema to this one
-- (schema to schema, as 20261120090000_app_assessment_place), then reordered
-- so each new index exists before the one it replaces is dropped.

-- CreateIndex
CREATE INDEX "app_assessment_orgId_status_createdAt_idx" ON "app_assessment"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "app_assessment_orgId_profile_status_createdAt_idx" ON "app_assessment"("orgId", "profile", "status", "createdAt");

-- CreateIndex
CREATE INDEX "app_judge_run_orgId_status_createdAt_idx" ON "app_judge_run"("orgId", "status", "createdAt");

-- DropIndex
DROP INDEX "app_assessment_orgId_status_idx";

-- DropIndex
DROP INDEX "app_judge_run_orgId_idx";
