-- LIMEX Route Book: field-sales prospect book (families → legs → stops),
-- shared per-stop marks, a permanent day-by-day event journal, saved views
-- and per-user preferences. Register data is seeded from prisma/data/route-book.json
-- on first use, never by this migration.

-- AlterEnum
ALTER TYPE "ActivityEntityType" ADD VALUE 'ROUTE_BOOK';

-- CreateTable
CREATE TABLE "RouteBookFamily" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "blurb" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RouteBookFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteBookLeg" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "belt" TEXT,
    "nav" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "familyId" TEXT NOT NULL,

    CONSTRAINT "RouteBookLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteBookStop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addr" TEXT,
    "makes" TEXT,
    "src" TEXT,
    "tags" JSONB,
    "precise" BOOLEAN NOT NULL DEFAULT false,
    "map" TEXT,
    "tel" TEXT,
    "telLabel" TEXT,
    "link" TEXT,
    "linkLabel" TEXT,
    "fit" TEXT NOT NULL DEFAULT 'good',
    "why" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "userAdded" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "legId" TEXT NOT NULL,
    "addedById" TEXT,

    CONSTRAINT "RouteBookStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteBookMark" (
    "stopId" TEXT NOT NULL,
    "ticked" BOOLEAN NOT NULL DEFAULT false,
    "tickedOn" TEXT,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "outcome" TEXT,
    "dueOn" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "addrOverride" TEXT,
    "addrPrecise" BOOLEAN,
    "dnc" BOOLEAN NOT NULL DEFAULT false,
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "dupOf" TEXT,
    "snoozedOn" TEXT,
    "companyId" TEXT,
    "followUpId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "RouteBookMark_pkey" PRIMARY KEY ("stopId")
);

-- CreateTable
CREATE TABLE "RouteBookLegMark" (
    "legId" TEXT NOT NULL,
    "ticked" BOOLEAN NOT NULL DEFAULT false,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "RouteBookLegMark_pkey" PRIMARY KEY ("legId")
);

-- CreateTable
CREATE TABLE "RouteBookEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT,
    "day" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopId" TEXT,
    "legId" TEXT,
    "userId" TEXT,

    CONSTRAINT "RouteBookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteBookView" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "RouteBookView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteBookPref" (
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteBookPref_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "RouteBookLeg_familyId_idx" ON "RouteBookLeg"("familyId");

-- CreateIndex
CREATE INDEX "RouteBookStop_legId_idx" ON "RouteBookStop"("legId");

-- CreateIndex
CREATE INDEX "RouteBookStop_fit_idx" ON "RouteBookStop"("fit");

-- CreateIndex
CREATE INDEX "RouteBookStop_name_idx" ON "RouteBookStop"("name");

-- CreateIndex
CREATE INDEX "RouteBookStop_userAdded_idx" ON "RouteBookStop"("userAdded");

-- CreateIndex
CREATE INDEX "RouteBookMark_ticked_idx" ON "RouteBookMark"("ticked");

-- CreateIndex
CREATE INDEX "RouteBookMark_starred_idx" ON "RouteBookMark"("starred");

-- CreateIndex
CREATE INDEX "RouteBookMark_dueOn_idx" ON "RouteBookMark"("dueOn");

-- CreateIndex
CREATE INDEX "RouteBookMark_outcome_idx" ON "RouteBookMark"("outcome");

-- CreateIndex
CREATE INDEX "RouteBookEvent_day_idx" ON "RouteBookEvent"("day");

-- CreateIndex
CREATE INDEX "RouteBookEvent_stopId_idx" ON "RouteBookEvent"("stopId");

-- CreateIndex
CREATE INDEX "RouteBookEvent_at_idx" ON "RouteBookEvent"("at");

-- AddForeignKey
ALTER TABLE "RouteBookLeg" ADD CONSTRAINT "RouteBookLeg_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "RouteBookFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteBookStop" ADD CONSTRAINT "RouteBookStop_legId_fkey" FOREIGN KEY ("legId") REFERENCES "RouteBookLeg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteBookStop" ADD CONSTRAINT "RouteBookStop_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteBookMark" ADD CONSTRAINT "RouteBookMark_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "RouteBookStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteBookMark" ADD CONSTRAINT "RouteBookMark_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteBookLegMark" ADD CONSTRAINT "RouteBookLegMark_legId_fkey" FOREIGN KEY ("legId") REFERENCES "RouteBookLeg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteBookLegMark" ADD CONSTRAINT "RouteBookLegMark_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteBookEvent" ADD CONSTRAINT "RouteBookEvent_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "RouteBookStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteBookEvent" ADD CONSTRAINT "RouteBookEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteBookView" ADD CONSTRAINT "RouteBookView_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteBookPref" ADD CONSTRAINT "RouteBookPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

