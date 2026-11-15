-- t-26: a judge run's reply moves to its own table, `app_judge_reply`, so the
-- retention purge can delete it after the workspace's reply window (D10,
-- 30 days unless set) while the run keeps its model, cost, tokens and timing.
--
-- Reviewed for spurious drops (B13): the generator also emitted `DROP INDEX`
-- for idx_ai_knowledge_chunk_search_vector, idx_knowledge_embedding and
-- idx_message_embedding, `ALTER COLUMN "searchVector" DROP DEFAULT` on
-- ai_knowledge_chunk, and `DROP CONSTRAINT` for the five hand-written FKs on
-- app_workspace_invitation (t-9), app_content and app_assessment (t-22).
-- Prisma cannot model any of them; they were removed from this file.
--
-- Existing replies are copied across before the columns go. A copied row's
-- `createdAt` is the migration's time, not when its reply was saved: the
-- purge starts on the first boot after deploy, and dating a copy from its run
-- would delete every reply past 30 days at once, before any workspace could
-- set a longer window. Each copy gets the full window from deploy instead.
--
-- The table is tenant-owned: it takes the `org_isolation` policy
-- (lib/tenancy/isolation.ts orgIsolationPolicySql(), verbatim), and the block
-- at the end follows the install's tenancy switch as
-- `20261114180010_app_assessments` does.

-- CreateTable
CREATE TABLE "app_judge_reply" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "judgeRunId" TEXT NOT NULL,
    "output" JSONB NOT NULL,
    "dropped" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_judge_reply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_judge_reply_judgeRunId_key" ON "app_judge_reply"("judgeRunId");

-- CreateIndex
CREATE INDEX "app_judge_reply_orgId_createdAt_idx" ON "app_judge_reply"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "app_judge_reply" ADD CONSTRAINT "app_judge_reply_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_judge_reply" ADD CONSTRAINT "app_judge_reply_judgeRunId_fkey" FOREIGN KEY ("judgeRunId") REFERENCES "app_judge_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy the replies already stored. Runs under the migrate role, which RLS
-- does not confine (MIGRATE_DATABASE_URL, .context/tenancy/isolation.md).
INSERT INTO "app_judge_reply" ("id", "orgId", "judgeRunId", "output", "dropped", "createdAt")
SELECT
    'jr' || replace(gen_random_uuid()::text, '-', ''),
    "orgId",
    "id",
    "output",
    COALESCE("dropped", '[]'::jsonb),
    CURRENT_TIMESTAMP
FROM "app_judge_run"
WHERE "output" IS NOT NULL;

-- AlterTable
ALTER TABLE "app_judge_run" DROP COLUMN "dropped",
DROP COLUMN "output";

-- app_judge_reply
CREATE POLICY "org_isolation" ON "app_judge_reply"
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
    ALTER TABLE "app_judge_reply" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "app_judge_reply" FORCE ROW LEVEL SECURITY;
  END IF;
END
$$;
