-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "buyerNameMismatchAcknowledged" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "legalName" TEXT;
