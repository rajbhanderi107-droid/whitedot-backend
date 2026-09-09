ALTER TABLE "RouteBookMark" ADD COLUMN "sourceFolder" TEXT;
ALTER TABLE "RouteBookMark" ADD CONSTRAINT "RouteBookMark_sourceFolder_check" CHECK ("sourceFolder" IS NULL OR "sourceFolder" IN ('GPT', 'CLAUDE', 'TEAM', 'UNKNOWN'));
