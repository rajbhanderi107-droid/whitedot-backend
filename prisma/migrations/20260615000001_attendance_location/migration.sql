-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'ON_LEAVE', 'WFH');

-- AlterTable: employee profile fields
ALTER TABLE "User"
  ADD COLUMN "jobTitle" TEXT,
  ADD COLUMN "department" TEXT,
  ADD COLUMN "phone" TEXT;

-- CreateTable
CREATE TABLE "AttendanceDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "firstPunchIn" TIMESTAMP(3) NOT NULL,
    "lastPunchOut" TIMESTAMP(3),
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "inLat" DOUBLE PRECISION,
    "inLng" DOUBLE PRECISION,
    "inAccuracy" DOUBLE PRECISION,
    "outLat" DOUBLE PRECISION,
    "outLng" DOUBLE PRECISION,
    "outAccuracy" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationPing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "kind" TEXT NOT NULL DEFAULT 'live',
    "date" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDay_userId_date_key" ON "AttendanceDay"("userId", "date");
CREATE INDEX "AttendanceDay_date_idx" ON "AttendanceDay"("date");
CREATE INDEX "AttendanceDay_userId_idx" ON "AttendanceDay"("userId");
CREATE INDEX "AttendanceDay_finalized_idx" ON "AttendanceDay"("finalized");
CREATE INDEX "LocationPing_userId_idx" ON "LocationPing"("userId");
CREATE INDEX "LocationPing_userId_date_idx" ON "LocationPing"("userId", "date");
CREATE INDEX "LocationPing_createdAt_idx" ON "LocationPing"("createdAt");

-- AddForeignKey
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
