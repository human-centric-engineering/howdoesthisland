-- t-74: a project's context documents (.context/app/projects.md). One row
-- links one of the workspace's knowledge documents to one project; the text,
-- its chunks and embeddings stay in core's knowledge base (D18).
--
-- Generated with `prisma migrate diff` from the previous schema to this one
-- (schema to schema, as 20261122100000_app_project was), and read: no drops.
--
-- Two hand-written FKs (B11), because a Prisma relation would edit core's
-- schema:
-- - `knowledgeDocumentId` → "ai_knowledge_document", CASCADE: a document
--   deleted through core's knowledge page takes its project links with it.
-- - `addedByUserId` → "user", SET NULL: the link is the workspace's and
--   outlives its adder's erasure.
-- Drift probes for both in lib/app/db-drift.ts.
--
-- The table is tenant-owned: it takes the `org_isolation` policy
-- (lib/tenancy/isolation.ts orgIsolationPolicySql(), verbatim), and the block
-- at the end follows the install's tenancy switch as
-- `20261114180010_app_assessments` does.

-- CreateTable
CREATE TABLE "app_project_document" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT NOT NULL,
    "knowledgeDocumentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT,
    "sourceUrl" TEXT,
    "createdByUpload" BOOLEAN NOT NULL DEFAULT false,
    "addedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_project_document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_project_document_knowledgeDocumentId_idx" ON "app_project_document"("knowledgeDocumentId");

-- CreateIndex
CREATE INDEX "app_project_document_orgId_idx" ON "app_project_document"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "app_project_document_projectId_knowledgeDocumentId_key" ON "app_project_document"("projectId", "knowledgeDocumentId");

-- AddForeignKey
ALTER TABLE "app_project_document" ADD CONSTRAINT "app_project_document_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_project_document" ADD CONSTRAINT "app_project_document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "app_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (hand-written, see the header)
ALTER TABLE "app_project_document" ADD CONSTRAINT "app_project_document_knowledgeDocumentId_fkey" FOREIGN KEY ("knowledgeDocumentId") REFERENCES "ai_knowledge_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (hand-written, see the header)
ALTER TABLE "app_project_document" ADD CONSTRAINT "app_project_document_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- app_project_document
CREATE POLICY "org_isolation" ON "app_project_document"
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
    ALTER TABLE "app_project_document" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "app_project_document" FORCE ROW LEVEL SECURITY;
  END IF;
END
$$;
