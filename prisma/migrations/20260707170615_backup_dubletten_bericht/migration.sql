-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "lastReportAt" TIMESTAMP(3),
ADD COLUMN     "lastReportHash" TEXT,
ADD COLUMN     "reportEmail" TEXT,
ADD COLUMN     "reportEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reportFrequency" TEXT;
