-- t-22: content, assessments and judge runs (app-plan §8.2, §9).
--
-- Reviewed for spurious drops (B13): the generator also emitted `DROP INDEX`
-- for idx_ai_knowledge_chunk_search_vector, idx_knowledge_embedding and
-- idx_message_embedding, `ALTER COLUMN "searchVector" DROP DEFAULT` on
-- ai_knowledge_chunk, and `DROP CONSTRAINT` for the two hand-written FKs on
-- app_workspace_invitation (t-9). Prisma cannot model any of them; they were
-- removed from this file.
--
-- `createdByUserId` (content, assessment) and `apiKeyId` (assessment) have
-- hand-written FKs to the mapped tables "user" and "ai_api_key" (B11), because
-- a Prisma relation would edit core's `User` and `AiApiKey`. Each has a drift
-- probe in lib/app/db-drift.ts. All three are SET NULL: the rows are the
-- workspace's, so they outlive a member's erasure and a revoked key, and an
-- assessment still says it came through the API.
--
-- The three tables are tenant-owned: each takes the `org_isolation` policy
-- (lib/tenancy/isolation.ts orgIsolationPolicySql(), verbatim), and the block
-- at the end follows the install's tenancy switch as `20261103120000_waitlist`
-- explains: if RLS is on for `ai_agent`, the new tables are enabled and forced.

-- CreateEnum
CREATE TYPE "ContentSourceKind" AS ENUM ('TEXT', 'FILE', 'URL');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssessmentVia" AS ENUM ('APP', 'API');

-- CreateEnum
CREATE TYPE "JudgeRunStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "app_content" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT,
    "title" TEXT,
    "sourceKind" "ContentSourceKind" NOT NULL,
    "sourceUrl" TEXT,
    "fileName" TEXT,
    "text" TEXT NOT NULL,
    "textSha256" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_assessment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "contentId" TEXT NOT NULL,
    "projectId" TEXT,
    "frameworkVersionId" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "judges" TEXT[],
    "context" JSONB NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'QUEUED',
    "result" JSONB,
    "overall" DOUBLE PRECISION,
    "band" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "requestedVia" "AssessmentVia" NOT NULL,
    "apiKeyId" TEXT,
    "createdByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_judge_run" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "assessmentId" TEXT NOT NULL,
    "judge" TEXT NOT NULL,
    "status" "JudgeRunStatus" NOT NULL,
    "provider" TEXT,
    "modelName" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tokens" JSONB,
    "latencyMs" INTEGER,
    "output" JSONB,
    "dropped" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_judge_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_content_orgId_createdAt_idx" ON "app_content"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "app_assessment_orgId_status_idx" ON "app_assessment"("orgId", "status");

-- CreateIndex
CREATE INDEX "app_assessment_status_leaseExpiresAt_idx" ON "app_assessment"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "app_assessment_contentId_idx" ON "app_assessment"("contentId");

-- CreateIndex
CREATE INDEX "app_judge_run_orgId_idx" ON "app_judge_run"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "app_judge_run_assessmentId_judge_key" ON "app_judge_run"("assessmentId", "judge");

-- AddForeignKey
ALTER TABLE "app_content" ADD CONSTRAINT "app_content_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_assessment" ADD CONSTRAINT "app_assessment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_assessment" ADD CONSTRAINT "app_assessment_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "app_content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_assessment" ADD CONSTRAINT "app_assessment_frameworkVersionId_fkey" FOREIGN KEY ("frameworkVersionId") REFERENCES "app_framework_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_judge_run" ADD CONSTRAINT "app_judge_run_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_judge_run" ADD CONSTRAINT "app_judge_run_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "app_assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (hand-written: content creator → user)
ALTER TABLE "app_content" ADD CONSTRAINT "app_content_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (hand-written: assessment requester → user)
ALTER TABLE "app_assessment" ADD CONSTRAINT "app_assessment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (hand-written: assessment → the API key it came through)
ALTER TABLE "app_assessment" ADD CONSTRAINT "app_assessment_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ai_api_key"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- app_content
CREATE POLICY "org_isolation" ON "app_content"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "orgId" = NULLIF(current_setting('app.current_org', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "orgId" = NULLIF(current_setting('app.current_org', true), '')
  );

-- app_assessment
CREATE POLICY "org_isolation" ON "app_assessment"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "orgId" = NULLIF(current_setting('app.current_org', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "orgId" = NULLIF(current_setting('app.current_org', true), '')
  );

-- app_judge_run
CREATE POLICY "org_isolation" ON "app_judge_run"
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
    ALTER TABLE "app_content" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "app_content" FORCE ROW LEVEL SECURITY;
    ALTER TABLE "app_assessment" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "app_assessment" FORCE ROW LEVEL SECURITY;
    ALTER TABLE "app_judge_run" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "app_judge_run" FORCE ROW LEVEL SECURITY;
  END IF;
END
$$;
