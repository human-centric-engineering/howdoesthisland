-- t-38: a calibration run is stored when it starts, so the admin page can
-- show one still running (.context/app/calibration.md).
--
-- Hand-written, not generated: the generator also emits the spurious drops
-- listed in 20261116214200_app_calibration_run, and none of them belong here.
--
-- Every run stored before this is complete, so the default is COMPLETE and
-- `totals` / `rows` keep their values; they become nullable because a RUNNING
-- or FAILED run has none.

-- CreateEnum
CREATE TYPE "CalibrationRunStatus" AS ENUM ('RUNNING', 'COMPLETE', 'FAILED');

-- AlterTable
ALTER TABLE "app_calibration_run"
    ADD COLUMN "status" "CalibrationRunStatus" NOT NULL DEFAULT 'COMPLETE',
    ADD COLUMN "error" TEXT,
    ADD COLUMN "finishedAt" TIMESTAMP(3),
    ALTER COLUMN "totals" DROP NOT NULL,
    ALTER COLUMN "rows" DROP NOT NULL;
