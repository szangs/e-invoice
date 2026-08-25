-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "aiConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "aiConfirmedBy" TEXT,
ADD COLUMN     "aiUncertainFields" TEXT;
