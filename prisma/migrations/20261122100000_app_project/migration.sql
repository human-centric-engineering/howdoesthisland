-- t-70: a workspace's projects (.context/app/projects.md). One row per
-- project; a review in it records it on its content and assessment rows.
--
-- Generated with `prisma migrate diff` from the previous schema to this one
-- (schema to schema, as 20261121140000_app_review_code_redemption was), and
-- read: no drops.
--
-- `createdByUserId` has a hand-written FK to the mapped table "user" (B11),
-- because a Prisma relation would edit core's `User`. SET NULL: the project is
-- the workspace's and outlives its maker's erasure. Drift probe in
-- lib/app/db-drift.ts.
--
-- `app_content.projectId` and `app_assessment.projectId` existed with no FK
-- (20261114180010_app_assessments). Only the demo-usage seed set them, to ids
-- of projects that did not exist (`demo-launch`), so they are cleared first;
-- the seed now makes its projects. They then reference the project, SET NULL.
--
-- The table is tenant-owned: it takes the `org_isolation` policy
-- (lib/tenancy/isolation.ts orgIsolationPolicySql(), verbatim), and the block
-- at the end follows the install's tenancy switch as
-- `20261114180010_app_assessments` does.

-- CreateTable
CREATE TABLE "app_project" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "brief" JSONB NOT NULL,
    "defaults" JSONB NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_project_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_project_orgId_archivedAt_createdAt_idx" ON "app_project"("orgId", "archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "app_assessment_projectId_createdAt_idx" ON "app_assessment"("projectId", "createdAt");

-- Clear what nothing could point at yet (see the header). Under the bypass
-- arm, because with row-level security forced the owner's update would
-- otherwise see no rows, and the foreign key below would then refuse them.
SELECT set_config('app.bypass_rls', 'on', false);
UPDATE "app_content" SET "projectId" = NULL WHERE "projectId" IS NOT NULL;
UPDATE "app_assessment" SET "projectId" = NULL WHERE "projectId" IS NOT NULL;
SELECT set_config('app.bypass_rls', '', false);

-- AddForeignKey
ALTER TABLE "app_content" ADD CONSTRAINT "app_content_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "app_project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_assessment" ADD CONSTRAINT "app_assessment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "app_project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_project" ADD CONSTRAINT "app_project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_project" ADD CONSTRAINT "app_project_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "app_framework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey (hand-written, see the header)
ALTER TABLE "app_project" ADD CONSTRAINT "app_project_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- app_project
CREATE POLICY "org_isolation" ON "app_project"
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
    ALTER TABLE "app_project" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "app_project" FORCE ROW LEVEL SECURITY;
  END IF;
END
$$;
