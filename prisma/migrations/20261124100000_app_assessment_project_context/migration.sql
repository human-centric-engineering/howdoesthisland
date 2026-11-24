-- t-75: what the AI reviewers were given of an assessment's project (its
-- brief, the documents used and the passages), .context/app/projects.md.
--
-- Generated with `prisma migrate diff` from the previous schema to this one,
-- and read (B13): one added nullable column, no drops, no rewrites. Existing
-- rows take NULL (no context was given), so nothing is backfilled. The table
-- already carries its `org_isolation` policy.

-- AlterTable
ALTER TABLE "app_assessment" ADD COLUMN     "projectContext" JSONB;
