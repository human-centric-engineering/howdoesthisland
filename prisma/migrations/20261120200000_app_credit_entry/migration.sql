-- t-57: a workspace's CopyCredits ledger (.context/app/credits.md). One row per
-- change to the balance; the balance is the sum of `amount`.
--
-- Generated with `prisma migrate diff` from the previous schema to this one
-- (schema to schema, as 20261120140000_app_budget_hold was), and read.
--
-- `actorUserId` has a hand-written FK to the mapped table "user" (B11),
-- because a Prisma relation would edit core's `User`. SET NULL: the ledger is
-- the workspace's and outlives its actor's erasure. Drift probe in
-- lib/app/db-drift.ts.
--
-- `(kind, reference)` is unique so one redemption or one review is credited or
-- charged once (t-58, t-60). Postgres treats NULLs as distinct, so an admin's
-- grants, which carry no reference, are not limited by it.
--
-- The table is tenant-owned: it takes the `org_isolation` policy
-- (lib/tenancy/isolation.ts orgIsolationPolicySql(), verbatim), and the block
-- at the end follows the install's tenancy switch as
-- `20261114180010_app_assessments` does.

-- CreateEnum
CREATE TYPE "CreditEntryKind" AS ENUM ('GRANT', 'ADJUST', 'REDEEM', 'CHARGE');

-- CreateTable
CREATE TABLE "app_credit_entry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "amount" INTEGER NOT NULL,
    "kind" "CreditEntryKind" NOT NULL,
    "reason" TEXT,
    "actorUserId" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_credit_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_credit_entry_orgId_createdAt_idx" ON "app_credit_entry"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "app_credit_entry_kind_reference_key" ON "app_credit_entry"("kind", "reference");

-- AddForeignKey
ALTER TABLE "app_credit_entry" ADD CONSTRAINT "app_credit_entry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey (hand-written, see the header)
ALTER TABLE "app_credit_entry" ADD CONSTRAINT "app_credit_entry_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- app_credit_entry
CREATE POLICY "org_isolation" ON "app_credit_entry"
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
    ALTER TABLE "app_credit_entry" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "app_credit_entry" FORCE ROW LEVEL SECURITY;
  END IF;
END
$$;
