-- t-99: when a review's or a comparison's finished event was queued for the
-- workspace's subscriptions (.context/app/webhooks.md, lib/app/events/notify.ts).
--
-- Reviewed for spurious drops (B13): the generator also emitted `DROP INDEX`
-- for the search and embedding indexes, `ALTER COLUMN "searchVector" DROP
-- DEFAULT` on ai_knowledge_chunk, and `DROP CONSTRAINT` for the hand-written
-- FKs on the app's tables. Prisma cannot model any of them; they were removed
-- from this file.
--
-- Work that had already ended is marked notified, so the recovery sweep does
-- not send events for history nobody subscribed to. A review counts as ended
-- in any final state; a comparison once its verdict has settled and none of
-- its drafts is queued or running, which is when it would have been sent.

-- AlterTable
ALTER TABLE "app_assessment" ADD COLUMN     "notifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "app_assessment_set" ADD COLUMN     "notifiedAt" TIMESTAMP(3);

UPDATE "app_assessment"
SET "notifiedAt" = COALESCE("completedAt", "updatedAt")
WHERE "status" IN ('COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

UPDATE "app_assessment_set" s
SET "notifiedAt" = COALESCE(s."verdictCompletedAt", s."updatedAt")
WHERE s."verdictStatus" IN ('COMPLETED', 'FAILED', 'SKIPPED')
  AND NOT EXISTS (
    SELECT 1
    FROM "app_assessment_set_member" m
    JOIN "app_assessment" a ON a."id" = m."assessmentId"
    WHERE m."setId" = s."id" AND a."status" IN ('QUEUED', 'RUNNING')
  );

-- CreateIndex
CREATE INDEX "app_assessment_orgId_notifiedAt_idx" ON "app_assessment"("orgId", "notifiedAt");

-- CreateIndex
CREATE INDEX "app_assessment_set_orgId_notifiedAt_idx" ON "app_assessment_set"("orgId", "notifiedAt");
