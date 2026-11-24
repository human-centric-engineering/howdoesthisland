-- t-81: rewrites (app-plan §8.2, .context/app/rewrites.md).
--
-- Reviewed for spurious drops (B13): the generator also emitted `DROP INDEX`
-- for idx_ai_knowledge_chunk_search_vector, idx_knowledge_embedding and
-- idx_message_embedding, `ALTER COLUMN "searchVector" DROP DEFAULT` on
-- ai_knowledge_chunk, and `DROP CONSTRAINT` for the thirteen hand-written FKs
-- on the app's tables. Prisma cannot model any of them; they were removed
-- from this file.
--
-- `createdByUserId` has a hand-written FK to the mapped table "user" (B11),
-- because a Prisma relation would edit core's `User`. SET NULL: the rewrite is
-- the workspace's and outlives its maker's erasure. Drift probe in
-- lib/app/db-drift.ts. The FK to app_assessment cascades, so deleting or
-- purging a review takes its rewrites.
--
-- The table is tenant-owned: it takes the `org_isolation` policy
-- (lib/tenancy/isolation.ts orgIsolationPolicySql(), verbatim), and the block
-- at the end follows the install's tenancy switch as
-- `20261114180010_app_assessments` does.

-- CreateEnum
CREATE TYPE "RewriteStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "app_rewrite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "assessmentId" TEXT NOT NULL,
    "focus" TEXT NOT NULL,
    "status" "RewriteStatus" NOT NULL DEFAULT 'RUNNING',
    "draft" TEXT NOT NULL DEFAULT '',
    "heldUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "provider" TEXT,
    "modelName" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" TEXT,
    "errorCode" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_rewrite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_rewrite_assessmentId_createdAt_idx" ON "app_rewrite"("assessmentId", "createdAt");

-- CreateIndex
CREATE INDEX "app_rewrite_orgId_status_createdAt_idx" ON "app_rewrite"("orgId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "app_rewrite" ADD CONSTRAINT "app_rewrite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_rewrite" ADD CONSTRAINT "app_rewrite_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "app_assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (hand-written, see the header)
ALTER TABLE "app_rewrite" ADD CONSTRAINT "app_rewrite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- app_rewrite
CREATE POLICY "org_isolation" ON "app_rewrite"
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
    ALTER TABLE "app_rewrite" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "app_rewrite" FORCE ROW LEVEL SECURITY;
  END IF;
END
$$;
