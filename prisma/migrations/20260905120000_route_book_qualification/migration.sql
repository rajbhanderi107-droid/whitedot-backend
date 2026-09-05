-- Route Book: fit profile, sample register, commercial settings.
--
-- Written idempotently on purpose. Production was built partly with
-- `prisma db push`, so "RevokedToken", "PasswordResetToken" and the two
-- User lockout columns already exist there while appearing in no migration.
-- A plain CREATE TABLE would abort this migration on production and take the
-- API down on its next boot. Guarding every statement lets the same file
-- apply cleanly to production AND to a fresh database, which also closes the
-- drift that made a freshly-migrated database 401 on every request.

-- ─── Pre-existing drift, reconciled ──────────────────────────────────────
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RevokedToken" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    CONSTRAINT "RevokedToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "RevokedToken_jti_key" ON "RevokedToken"("jti");
CREATE INDEX IF NOT EXISTS "RevokedToken_jti_idx" ON "RevokedToken"("jti");
CREATE INDEX IF NOT EXISTS "RevokedToken_expiresAt_idx" ON "RevokedToken"("expiresAt");

-- ─── Fit profile on the existing mark row ────────────────────────────────
ALTER TABLE "RouteBookMark"
  ADD COLUMN IF NOT EXISTS "polymers"      TEXT,
  ADD COLUMN IF NOT EXISTS "processes"     TEXT,
  ADD COLUMN IF NOT EXISTS "monthlyTonnes" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "machines"      INTEGER,
  ADD COLUMN IF NOT EXISTS "fillerPct"     INTEGER,
  ADD COLUMN IF NOT EXISTS "resinRate"     DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "thinWall"      BOOLEAN,
  ADD COLUMN IF NOT EXISTS "profiledOn"    TEXT;

CREATE INDEX IF NOT EXISTS "RouteBookMark_monthlyTonnes_idx" ON "RouteBookMark"("monthlyTonnes");

-- ─── Sample register ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RouteBookSample" (
    "id" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "kg" DECIMAL(10,2) NOT NULL,
    "givenOn" TEXT NOT NULL,
    "contactName" TEXT,
    "trialDueOn" TEXT,
    "result" TEXT NOT NULL DEFAULT 'PENDING',
    "resultOn" TEXT,
    "resultNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "RouteBookSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RouteBookSample_stopId_idx"     ON "RouteBookSample"("stopId");
CREATE INDEX IF NOT EXISTS "RouteBookSample_result_idx"     ON "RouteBookSample"("result");
CREATE INDEX IF NOT EXISTS "RouteBookSample_givenOn_idx"    ON "RouteBookSample"("givenOn");
CREATE INDEX IF NOT EXISTS "RouteBookSample_trialDueOn_idx" ON "RouteBookSample"("trialDueOn");

-- ─── Commercial assumptions (one row, id 'singleton') ────────────────────
CREATE TABLE IF NOT EXISTS "RouteBookSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "limexRate" DECIMAL(10,2),
    "substitutionPct" INTEGER NOT NULL DEFAULT 30,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    CONSTRAINT "RouteBookSetting_pkey" PRIMARY KEY ("id")
);

-- ─── Foreign keys (no IF NOT EXISTS for constraints, so guard each) ──────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PasswordResetToken_userId_fkey') THEN
    ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RevokedToken_userId_fkey') THEN
    ALTER TABLE "RevokedToken" ADD CONSTRAINT "RevokedToken_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RouteBookSample_stopId_fkey') THEN
    ALTER TABLE "RouteBookSample" ADD CONSTRAINT "RouteBookSample_stopId_fkey"
      FOREIGN KEY ("stopId") REFERENCES "RouteBookMark"("stopId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RouteBookSample_createdById_fkey') THEN
    ALTER TABLE "RouteBookSample" ADD CONSTRAINT "RouteBookSample_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RouteBookSetting_updatedById_fkey') THEN
    ALTER TABLE "RouteBookSetting" ADD CONSTRAINT "RouteBookSetting_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
