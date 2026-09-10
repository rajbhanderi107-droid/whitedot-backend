-- The Trial Book: one row per LIMEX trial, in the same fifteen heads as the
-- workbook on the laptop. The folder stays the record of truth; trialNo is
-- handed out here so the portal and the folder always agree, and is never
-- reused once given.
CREATE TABLE "TrialReport" (
    "id" TEXT NOT NULL,
    "trialNo" INTEGER NOT NULL,
    "projectBackground" TEXT,
    "mouldingProcess" TEXT,
    "limexGrade" TEXT,
    "mixBatch" TEXT,
    "mixResin" TEXT,
    "mixLimex" TEXT,
    "colouring" TEXT,
    "product" TEXT,
    "brandOwner" TEXT,
    "originalResin" TEXT,
    "barrelTemp" TEXT,
    "originalWeight" TEXT,
    "trialWeight" TEXT,
    "result" TEXT,
    "problems" TEXT,
    "nextStep" TEXT,
    "imageName" TEXT,
    "imageDriveUrl" TEXT,
    "imageLocal" TEXT,
    "stopId" TEXT,
    "company" TEXT,
    "trialOn" TEXT,
    "fileName" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "TrialReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrialReport_trialNo_key" ON "TrialReport"("trialNo");
CREATE INDEX "TrialReport_trialNo_idx" ON "TrialReport"("trialNo");
CREATE INDEX "TrialReport_stopId_idx" ON "TrialReport"("stopId");
CREATE INDEX "TrialReport_trialOn_idx" ON "TrialReport"("trialOn");

ALTER TABLE "TrialReport" ADD CONSTRAINT "TrialReport_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
