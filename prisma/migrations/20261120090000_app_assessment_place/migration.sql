-- t-28: a place under the workspace's running limit for a review kept nowhere
-- (`store: false`), which has no app_assessment row for the claim to count.
-- See lib/app/assessments/places.ts.
--
-- Generated with `prisma migrate diff` from the previous schema to this one
-- (schema to schema, so the generator saw nothing it cannot model and emitted
-- no spurious drops; B13 checked by reading it). `migrate dev --create-only`
-- refuses this database for drift it cannot model, which is the same set.
--
-- The table is tenant-owned: it takes the `org_isolation` policy
-- (lib/tenancy/isolation.ts orgIsolationPolicySql(), verbatim), and the block
-- at the end follows the install's tenancy switch as
-- `20261114180010_app_assessments` does.

-- CreateTable
CREATE TABLE "app_assessment_place" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_assessment_place_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_assessment_place_orgId_leaseExpiresAt_idx" ON "app_assessment_place"("orgId", "leaseExpiresAt");

-- AddForeignKey
ALTER TABLE "app_assessment_place" ADD CONSTRAINT "app_assessment_place_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- app_assessment_place
CREATE POLICY "org_isolation" ON "app_assessment_place"
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
    ALTER TABLE "app_assessment_place" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "app_assessment_place" FORCE ROW LEVEL SECURITY;
  END IF;
END
$$;
