-- t-87: comparison sets (app-plan §9, .context/app/comparisons.md).
--
-- Reviewed for spurious drops (B13): the generator also emitted `DROP INDEX`
-- for idx_ai_knowledge_chunk_search_vector, idx_knowledge_embedding and
-- idx_message_embedding, `ALTER COLUMN "searchVector" DROP DEFAULT` on
-- ai_knowledge_chunk, and `DROP CONSTRAINT` for the fourteen hand-written FKs
-- on the app's tables. Prisma cannot model any of them; they were removed
-- from this file.
--
-- `createdByUserId` has a hand-written FK to the mapped table "user" (B11),
-- because a Prisma relation would edit core's `User`. SET NULL: the set is
-- the workspace's and outlives its maker's erasure. Drift probe in
-- lib/app/db-drift.ts. A member's FK to app_assessment is SET NULL, so a
-- review deleted or purged leaves the member, read as purged; the set's
-- members cascade with it.
--
-- Both tables are tenant-owned: each takes the `org_isolation` policy
-- (lib/tenancy/isolation.ts orgIsolationPolicySql(), verbatim), and the block
-- at the end follows the install's tenancy switch as
-- `20261114180010_app_assessments` does.

-- CreateEnum
CREATE TYPE "AssessmentSetKind" AS ENUM ('COMPARISON');

-- CreateTable
CREATE TABLE "app_assessment_set" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "kind" "AssessmentSetKind" NOT NULL,
    "projectId" TEXT,
    "frameworkVersionId" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "judges" TEXT[],
    "context" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_assessment_set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_assessment_set_member" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "setId" TEXT NOT NULL,
    "assessmentId" TEXT,
    "position" INTEGER NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_assessment_set_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_assessment_set_orgId_kind_createdAt_idx" ON "app_assessment_set"("orgId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "app_assessment_set_projectId_idx" ON "app_assessment_set"("projectId");

-- CreateIndex
CREATE INDEX "app_assessment_set_member_assessmentId_idx" ON "app_assessment_set_member"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "app_assessment_set_member_setId_position_key" ON "app_assessment_set_member"("setId", "position");

-- AddForeignKey
ALTER TABLE "app_assessment_set" ADD CONSTRAINT "app_assessment_set_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_assessment_set" ADD CONSTRAINT "app_assessment_set_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "app_project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_assessment_set" ADD CONSTRAINT "app_assessment_set_frameworkVersionId_fkey" FOREIGN KEY ("frameworkVersionId") REFERENCES "app_framework_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_assessment_set_member" ADD CONSTRAINT "app_assessment_set_member_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_assessment_set_member" ADD CONSTRAINT "app_assessment_set_member_setId_fkey" FOREIGN KEY ("setId") REFERENCES "app_assessment_set"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_assessment_set_member" ADD CONSTRAINT "app_assessment_set_member_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "app_assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey (hand-written, see the header)
ALTER TABLE "app_assessment_set" ADD CONSTRAINT "app_assessment_set_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- app_assessment_set
CREATE POLICY "org_isolation" ON "app_assessment_set"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "orgId" = NULLIF(current_setting('app.current_org', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "orgId" = NULLIF(current_setting('app.current_org', true), '')
  );

-- app_assessment_set_member
CREATE POLICY "org_isolation" ON "app_assessment_set_member"
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
    ALTER TABLE "app_assessment_set" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "app_assessment_set" FORCE ROW LEVEL SECURITY;
    ALTER TABLE "app_assessment_set_member" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "app_assessment_set_member" FORCE ROW LEVEL SECURITY;
  END IF;
END
$$;
