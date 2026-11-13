-- Framework store (t-10): four shared-config tables, no orgId (app-plan §8.1).
-- B13: the generator also emitted drops for the vector and full-text indexes,
-- the searchVector default and t-9's hand-written user FKs, none of which the
-- schema can model. Stripped by hand.

-- CreateEnum
CREATE TYPE "FrameworkVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateTable
CREATE TABLE "app_framework" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_framework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_framework_version" (
    "id" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "status" "FrameworkVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceDocument" JSONB NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "calibration" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_framework_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_framework_node" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "parentKey" TEXT,
    "name" TEXT,
    "position" INTEGER NOT NULL,
    "attributes" JSONB NOT NULL,

    CONSTRAINT "app_framework_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_framework_link" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,

    CONSTRAINT "app_framework_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_framework_slug_key" ON "app_framework"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "app_framework_version_frameworkId_version_key" ON "app_framework_version"("frameworkId", "version");

-- CreateIndex
CREATE INDEX "app_framework_node_versionId_kind_position_idx" ON "app_framework_node"("versionId", "kind", "position");

-- CreateIndex
CREATE UNIQUE INDEX "app_framework_node_versionId_kind_key_key" ON "app_framework_node"("versionId", "kind", "key");

-- CreateIndex
CREATE INDEX "app_framework_link_toNodeId_idx" ON "app_framework_link"("toNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "app_framework_link_versionId_fromNodeId_toNodeId_relation_key" ON "app_framework_link"("versionId", "fromNodeId", "toNodeId", "relation");

-- AddForeignKey
ALTER TABLE "app_framework_version" ADD CONSTRAINT "app_framework_version_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "app_framework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_framework_node" ADD CONSTRAINT "app_framework_node_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "app_framework_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_framework_link" ADD CONSTRAINT "app_framework_link_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "app_framework_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_framework_link" ADD CONSTRAINT "app_framework_link_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "app_framework_node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_framework_link" ADD CONSTRAINT "app_framework_link_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "app_framework_node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
