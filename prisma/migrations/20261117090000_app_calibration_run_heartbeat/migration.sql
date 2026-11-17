-- t-38 review: a running calibration run beats while it is alive, and one
-- whose beat has stopped is shown as stopped (.context/app/calibration.md).
--
-- Hand-written, not generated: the generator also emits the spurious drops
-- listed in 20261116214200_app_calibration_run, and none of them belong here.
--
-- `status` loses its default: every writer sets it, and the COMPLETE default
-- only backfilled the runs stored before 20261116230000. A row inserted
-- without a status would otherwise be a complete run with no results.

-- AlterTable
ALTER TABLE "app_calibration_run"
    ADD COLUMN "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "status" DROP DEFAULT;

-- The running-run check reads a version's running AI runs.
CREATE INDEX "app_calibration_run_frameworkVersionId_mode_status_idx"
    ON "app_calibration_run"("frameworkVersionId", "mode", "status");
