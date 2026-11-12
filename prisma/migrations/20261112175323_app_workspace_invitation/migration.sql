-- t-9: invitations into a workspace for people who already have an account.
--
-- Reviewed for spurious drops (B13): the generator also emitted
-- `DROP INDEX` for idx_ai_knowledge_chunk_search_vector, idx_knowledge_embedding
-- and idx_message_embedding, and `ALTER COLUMN "searchVector" DROP DEFAULT` on
-- ai_knowledge_chunk. Prisma cannot model those objects; they are core's and
-- were removed from this file.
--
-- `userId` and `invitedByUserId` have hand-written FKs to "user" (the mapped
-- table, B11) because a Prisma relation would edit core's `User` model. Each has
-- a drift probe in lib/app/db-drift.ts. The invitee's rows go with their
-- account; the inviter's id is cleared, and the workspace keeps the record.
--
-- The table is tenant-owned: it takes the `org_isolation` policy
-- (lib/tenancy/isolation.ts orgIsolationPolicySql(), verbatim), and the block at
-- the end follows the install's tenancy switch as `20261103120000_waitlist`
-- explains: if RLS is on for `ai_agent`, the new table is enabled and forced too.

-- CreateEnum
CREATE TYPE "WorkspaceInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "app_workspace_invitation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "status" "WorkspaceInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_workspace_invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_workspace_invitation_userId_status_idx" ON "app_workspace_invitation"("userId", "status");

-- CreateIndex
CREATE INDEX "app_workspace_invitation_orgId_idx" ON "app_workspace_invitation"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "app_workspace_invitation_orgId_userId_key" ON "app_workspace_invitation"("orgId", "userId");

-- AddForeignKey
ALTER TABLE "app_workspace_invitation" ADD CONSTRAINT "app_workspace_invitation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (hand-written: invitee → user)
ALTER TABLE "app_workspace_invitation" ADD CONSTRAINT "app_workspace_invitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (hand-written: inviter → user)
ALTER TABLE "app_workspace_invitation" ADD CONSTRAINT "app_workspace_invitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- app_workspace_invitation
CREATE POLICY "org_isolation" ON "app_workspace_invitation"
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
    ALTER TABLE "app_workspace_invitation" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "app_workspace_invitation" FORCE ROW LEVEL SECURITY;
  END IF;
END
$$;
