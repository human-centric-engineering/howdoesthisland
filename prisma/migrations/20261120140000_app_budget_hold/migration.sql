-- t-50, t-51: what a review request holds of its workspace's monthly budget
-- from its budget check until its assessment is stored, or, kept nowhere
-- (`store: false`), until its run ends. See lib/app/usage/budget.ts.
--
-- Generated with `prisma migrate diff` from the previous schema to this one
-- (schema to schema, as 20261120090000_app_assessment_place was), and read.
--
-- The table is tenant-owned: it takes the `org_isolation` policy
-- (lib/tenancy/isolation.ts orgIsolationPolicySql(), verbatim), and the block
-- at the end follows the install's tenancy switch as
-- `20261114180010_app_assessments` does.

-- CreateTable
CREATE TABLE "app_budget_hold" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "judges" INTEGER NOT NULL,
    "stored" BOOLEAN NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_budget_hold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_budget_hold_orgId_leaseExpiresAt_idx" ON "app_budget_hold"("orgId", "leaseExpiresAt");

-- AddForeignKey
ALTER TABLE "app_budget_hold" ADD CONSTRAINT "app_budget_hold_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- app_budget_hold
CREATE POLICY "org_isolation" ON "app_budget_hold"
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
    ALTER TABLE "app_budget_hold" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "app_budget_hold" FORCE ROW LEVEL SECURITY;
  END IF;
END
$$;
