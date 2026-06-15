-- Add EMPLOYEE to the Role enum (isolated so the value is committed
-- before any later migration could reference it).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'EMPLOYEE';
