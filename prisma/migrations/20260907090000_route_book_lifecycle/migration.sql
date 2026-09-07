-- Route Book lifecycle: one company, three books.
--
-- A stop's mark gains a `stage`, so Route Book / Lead Book / Customer Book are
-- three views of one row rather than three copies that drift apart. Orders are
-- recorded in metric tonnes, which is how LIMEX is sold.
--
-- Written idempotently, same as the previous Route Book migration: production
-- carries drift from an early `prisma db push`, and a statement that aborts
-- here takes the API down on its next boot.

-- ─── Lifecycle columns on the mark ───────────────────────────────────────
ALTER TABLE "RouteBookMark"
  ADD COLUMN IF NOT EXISTS "stage"        TEXT NOT NULL DEFAULT 'PROSPECT',
  ADD COLUMN IF NOT EXISTS "leadOn"       TEXT,
  ADD COLUMN IF NOT EXISTS "customerOn"   TEXT,
  ADD COLUMN IF NOT EXISTS "lostOn"       TEXT,
  ADD COLUMN IF NOT EXISTS "lostReason"   TEXT,
  ADD COLUMN IF NOT EXISTS "nextStep"     TEXT,
  ADD COLUMN IF NOT EXISTS "expectedMt"   DECIMAL(12,3),
  ADD COLUMN IF NOT EXISTS "quotedRate"   DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "gstNumber"    TEXT,
  ADD COLUMN IF NOT EXISTS "billTo"       TEXT,
  ADD COLUMN IF NOT EXISTS "shipTo"       TEXT,
  ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT,
  ADD COLUMN IF NOT EXISTS "inquiryId"    TEXT;

CREATE INDEX IF NOT EXISTS "RouteBookMark_stage_idx" ON "RouteBookMark"("stage");

-- ─── Orders, in metric tonnes ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RouteBookOrder" (
    "id"          TEXT NOT NULL,
    "stopId"      TEXT NOT NULL,
    "orderNo"     TEXT NOT NULL,
    "grade"       TEXT NOT NULL,
    "quantityMt"  DECIMAL(12,3) NOT NULL,
    "rate"        DECIMAL(10,2),
    "amount"      DECIMAL(16,2),
    "orderedOn"   TEXT NOT NULL,
    "dispatchOn"  TEXT,
    "status"      TEXT NOT NULL DEFAULT 'CONFIRMED',
    "poRef"       TEXT,
    "note"        TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "RouteBookOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RouteBookOrder_orderNo_key" ON "RouteBookOrder"("orderNo");
CREATE INDEX IF NOT EXISTS "RouteBookOrder_stopId_idx"    ON "RouteBookOrder"("stopId");
CREATE INDEX IF NOT EXISTS "RouteBookOrder_status_idx"    ON "RouteBookOrder"("status");
CREATE INDEX IF NOT EXISTS "RouteBookOrder_orderedOn_idx" ON "RouteBookOrder"("orderedOn");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RouteBookOrder_stopId_fkey') THEN
    ALTER TABLE "RouteBookOrder"
      ADD CONSTRAINT "RouteBookOrder_stopId_fkey"
      FOREIGN KEY ("stopId") REFERENCES "RouteBookMark"("stopId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RouteBookOrder_createdById_fkey') THEN
    ALTER TABLE "RouteBookOrder"
      ADD CONSTRAINT "RouteBookOrder_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
