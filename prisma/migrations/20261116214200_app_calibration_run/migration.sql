-- t-37: calibration runs (.context/app/calibration.md).
--
-- Reviewed for spurious drops (B13): the generator also emitted `DROP INDEX`
-- for idx_ai_knowledge_chunk_search_vector, idx_knowledge_embedding and
-- idx_message_embedding, `ALTER COLUMN "searchVector" DROP DEFAULT` on
-- ai_knowledge_chunk, and `DROP CONSTRAINT` for the six hand-written FKs on
-- app_workspace_invitation (t-9), app_content, app_assessment (t-22) and
-- app_report_share (t-32). Prisma cannot model any of them; they were removed
-- from this file.
--
-- `startedByUserId` has a hand-written FK to the mapped table "user" (B11),
-- because a Prisma relation would edit core's `User`. SET NULL: the run is the
-- install's record of a version's calibration and outlives whoever started
-- it. Drift probe in lib/app/db-drift.ts. The FK to app_framework_version
-- cascades: a run says nothing once its version is gone.
--
-- The table is owned by the install org: it takes the `org_isolation` policy
-- (lib/tenancy/isolation.ts orgIsolationPolicySql(), verbatim), and the block
-- at the end follows the install's tenancy switch as
-- `20261114180010_app_assessments` does.

-- CreateEnum
CREATE TYPE "CalibrationMode" AS ENUM ('QUICK', 'AI');

-- CreateTable
CREATE TABLE "app_calibration_run" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "frameworkVersionId" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "setVersion" TEXT NOT NULL,
    "mode" "CalibrationMode" NOT NULL,
    "judgeModels" JSONB NOT NULL,
    "totals" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_calibration_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_calibration_run_frameworkVersionId_mode_createdAt_idx" ON "app_calibration_run"("frameworkVersionId", "mode", "createdAt");

-- CreateIndex
CREATE INDEX "app_calibration_run_mode_createdAt_idx" ON "app_calibration_run"("mode", "createdAt");

-- CreateIndex
CREATE INDEX "app_calibration_run_orgId_idx" ON "app_calibration_run"("orgId");

-- AddForeignKey
ALTER TABLE "app_calibration_run" ADD CONSTRAINT "app_calibration_run_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_calibration_run" ADD CONSTRAINT "app_calibration_run_frameworkVersionId_fkey" FOREIGN KEY ("frameworkVersionId") REFERENCES "app_framework_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (hand-written, see the header)
ALTER TABLE "app_calibration_run" ADD CONSTRAINT "app_calibration_run_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- app_calibration_run
CREATE POLICY "org_isolation" ON "app_calibration_run"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "orgId" = NULLIF(current_setting('app.current_org', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "orgId" = NULLIF(current_setting('app.current_org', true), '')
  );

-- Follow the install's tenancy switch (see the header).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = to_regclass(format('%I.ai_agent', current_schema())) AND relrowsecurity
  ) THEN
    ALTER TABLE "app_calibration_run" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "app_calibration_run" FORCE ROW LEVEL SECURITY;
  END IF;
END
$$;
