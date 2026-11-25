-- t-85: what a rewrite's call is priced from, kept as it starts, so recovery
-- can price one whose process died part-way.
ALTER TABLE "app_rewrite" ADD COLUMN "callStart" JSONB;
