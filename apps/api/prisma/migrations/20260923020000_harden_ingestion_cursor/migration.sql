-- AlterTable: operator-visible ingestion health fields (backward compatible,
-- all new columns are optional or default-valued so existing rows are unaffected).
ALTER TABLE "IngestionCursor" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "IngestionCursor" ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "IngestionCursor" ADD COLUMN "lastError" TEXT;
ALTER TABLE "IngestionCursor" ADD COLUMN "lastSuccessAt" TIMESTAMP(3);
ALTER TABLE "IngestionCursor" ADD COLUMN "gapDetectedAt" TIMESTAMP(3);
ALTER TABLE "IngestionCursor" ADD COLUMN "lastGapLedgerDelta" INTEGER;
