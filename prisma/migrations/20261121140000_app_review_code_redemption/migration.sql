-- t-60: redeeming a free review code (.context/app/credits.md). One row per
-- redemption; a code's redemptions are counted from these rows, so the
-- shared code row is never written by a customer and its `redemptionCount`
-- column goes. No code has been redeemed before this migration (t-60 is the
-- first redeem path), so the dropped column held 0 everywhere.
--
-- Generated with `prisma migrate diff` from the previous schema to this one
-- (schema to schema, as 20261121100000_app_review_code was), and read.
--
-- `(codeId, slot)` is unique, and each row is written with a slot below the
-- code's `maxRedemptions`, so redemptions racing for a code's last use cannot
-- both take it. `(codeId, userId)` is unique: one per person per code
-- (NULLs are distinct, so an erased person's row counts against no one).
--
-- Rows are never deleted. The code FK is RESTRICT, and the org FK is SET NULL,
-- not CASCADE: a use outlives the workspace's erasure, so a workspace erased
-- after redeeming a personal code does not make it redeemable again.
--
-- `userId` has a hand-written FK to the mapped table "user" (B11), because a
-- Prisma relation would edit core's `User`. SET NULL, as above. Drift probe in
-- lib/app/db-drift.ts.
--
-- The table is tenant-owned: it takes the `org_isolation` policy
-- (lib/tenancy/isolation.ts orgIsolationPolicySql(), verbatim), and the block
-- at the end follows the install's tenancy switch as
-- `20261120200000_app_credit_entry` does.

-- AlterTable
ALTER TABLE "app_review_code" DROP COLUMN "redemptionCount";

-- CreateTable
CREATE TABLE "app_review_code_redemption" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "orgId" TEXT,
    "userId" TEXT,
    "credits" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_review_code_redemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_review_code_redemption_orgId_createdAt_idx" ON "app_review_code_redemption"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "app_review_code_redemption_codeId_slot_key" ON "app_review_code_redemption"("codeId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "app_review_code_redemption_codeId_userId_key" ON "app_review_code_redemption"("codeId", "userId");

-- AddForeignKey
ALTER TABLE "app_review_code_redemption" ADD CONSTRAINT "app_review_code_redemption_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "app_review_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_review_code_redemption" ADD CONSTRAINT "app_review_code_redemption_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey (hand-written, see the header)
ALTER TABLE "app_review_code_redemption" ADD CONSTRAINT "app_review_code_redemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- app_review_code_redemption
CREATE POLICY "org_isolation" ON "app_review_code_redemption"
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
    ALTER TABLE "app_review_code_redemption" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "app_review_code_redemption" FORCE ROW LEVEL SECURITY;
  END IF;
END
$$;
