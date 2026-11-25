-- t-88: the editor's verdict on a comparison (.context/app/comparisons.md).
--
-- Reviewed for spurious drops (B13): the generator also emitted `DROP INDEX`
-- for idx_ai_knowledge_chunk_search_vector, idx_knowledge_embedding and
-- idx_message_embedding, `ALTER COLUMN "searchVector" DROP DEFAULT` on
-- ai_knowledge_chunk, and `DROP CONSTRAINT` for the fifteen hand-written FKs
-- on the app's tables. Prisma cannot model any of them; they were removed
-- from this file.
--
-- Comparisons made before this migration held nothing for a verdict and
-- asked for none, so they are `SKIPPED` (`predates_verdicts`): left
-- `WAITING`, the recovery job would start a paid call nobody asked for.

-- CreateEnum
CREATE TYPE "ComparisonVerdictStatus" AS ENUM ('WAITING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "app_assessment_set" ADD COLUMN     "verdict" JSONB,
ADD COLUMN     "verdictAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verdictCompletedAt" TIMESTAMP(3),
ADD COLUMN     "verdictCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "verdictHeldUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "verdictLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "verdictModel" TEXT,
ADD COLUMN     "verdictReason" TEXT,
ADD COLUMN     "verdictStatus" "ComparisonVerdictStatus" NOT NULL DEFAULT 'WAITING';

UPDATE "app_assessment_set" SET "verdictStatus" = 'SKIPPED', "verdictReason" = 'predates_verdicts';

-- AlterTable
ALTER TABLE "app_budget_hold" ADD COLUMN     "extraUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "app_assessment_set_orgId_verdictStatus_idx" ON "app_assessment_set"("orgId", "verdictStatus");
