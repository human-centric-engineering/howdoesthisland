-- A review refused by the budget as it is claimed (t-53): its code and figures.
ALTER TABLE "app_assessment" ADD COLUMN "errorCode" TEXT,
ADD COLUMN "errorDetails" JSONB;
