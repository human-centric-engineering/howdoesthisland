-- t-26: the retention purge deletes a workspace's assessments made before its
-- content window (`orgId` + `createdAt < cutoff`). Without this index each
-- daily pass scans the org's whole history through (orgId, status).
--
-- Hand-written rather than generated: the generator also emits the spurious
-- drops listed in 20261115105651_app_judge_reply (B13).

-- CreateIndex
CREATE INDEX "app_assessment_orgId_createdAt_idx" ON "app_assessment"("orgId", "createdAt");
