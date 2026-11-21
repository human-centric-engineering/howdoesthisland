-- t-59: free review codes (.context/app/credits.md). One row per code; its
-- redemptions (t-60) count against `maxRedemptions`.
--
-- Generated with `prisma migrate diff` from the previous schema to this one
-- (schema to schema, as 20261120200000_app_credit_entry was), and read.
--
-- Install-level shared config (`globalConfig` in
-- lib/app/tenancy-classification.ts): no `orgId`, so no `org_isolation`
-- policy, as the framework store's tables (20261112214616_app_frameworks).
--
-- `createdByUserId` has a hand-written FK to the mapped table "user" (B11),
-- because a Prisma relation would edit core's `User`. SET NULL: the code
-- outlives its maker's erasure. Drift probe in lib/app/db-drift.ts.
--
-- `(idempotencyKey, batchIndex)` is unique so a retried issuing call mints its
-- codes once. Postgres treats NULLs as distinct, so calls without a key are
-- not limited by it.

-- CreateTable
CREATE TABLE "app_review_code" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "creditsPerRedemption" INTEGER NOT NULL,
    "maxRedemptions" INTEGER NOT NULL,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "campaign" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "batchIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_review_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_review_code_code_key" ON "app_review_code"("code");

-- CreateIndex
CREATE INDEX "app_review_code_createdAt_idx" ON "app_review_code"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "app_review_code_idempotencyKey_batchIndex_key" ON "app_review_code"("idempotencyKey", "batchIndex");


-- AddForeignKey (hand-written, see the header)
ALTER TABLE "app_review_code" ADD CONSTRAINT "app_review_code_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
