-- t-101: batches of texts and pages (.context/app/batches.md).
--
-- Written by hand: the change is two statements and a constraint, and a
-- generated diff would carry the spurious drops B13 describes (the search and
-- embedding indexes, the hand-written FKs on the app's tables), which would
-- all have to be stripped again.
--
-- A batch is a third kind of set, beside a comparison.
ALTER TYPE "AssessmentSetKind" ADD VALUE 'BATCH';

-- A page a batch names is fetched when its own review starts, not in the
-- request (lib/app/assessments/run.ts), so its content row exists before its
-- text does. The three columns intake writes from the text are null until
-- the fetch succeeds, and are written together.
ALTER TABLE "app_content"
  ALTER COLUMN "text" DROP NOT NULL,
  ALTER COLUMN "textSha256" DROP NOT NULL,
  ALTER COLUMN "wordCount" DROP NOT NULL;

-- What makes "no text" mean one thing only: a page, with its address, not
-- fetched yet. The three columns are null together or not at all. Prisma
-- cannot model a CHECK constraint, so it is probed (lib/app/db-drift.ts).
ALTER TABLE "app_content"
  ADD CONSTRAINT "app_content_text_pending_fetch" CHECK (
    ("text" IS NOT NULL AND "textSha256" IS NOT NULL AND "wordCount" IS NOT NULL)
    OR ("text" IS NULL AND "textSha256" IS NULL AND "wordCount" IS NULL
        AND "sourceKind" = 'URL' AND "sourceUrl" IS NOT NULL)
  );
