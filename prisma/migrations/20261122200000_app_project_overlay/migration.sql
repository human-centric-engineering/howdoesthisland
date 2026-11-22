-- t-72: a project's adjustment to the framework's weights (D5,
-- .context/app/projects.md), and the one each assessment was scored with.
--
-- Generated with `prisma migrate diff` from the previous schema to this one,
-- and read (B13): two added columns, no drops, no rewrites. "No adjustment"
-- is NULL on an assessment and `{}` on a project (whose overlay can be
-- cleared, and `lib/app/**` may not write SQL NULL to a JSON column), which
-- is what every existing row takes, so nothing is backfilled. Both tables
-- already carry their `org_isolation` policy.

-- AlterTable
ALTER TABLE "app_assessment" ADD COLUMN     "overlay" JSONB;

-- AlterTable
ALTER TABLE "app_project" ADD COLUMN     "overlay" JSONB NOT NULL DEFAULT '{}';
