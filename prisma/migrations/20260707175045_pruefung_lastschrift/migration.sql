-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "checkAccountingAt" TIMESTAMP(3),
ADD COLUMN     "checkAccountingBy" TEXT,
ADD COLUMN     "checkElectronicAt" TIMESTAMP(3),
ADD COLUMN     "checkElectronicBy" TEXT,
ADD COLUMN     "checkFormalAt" TIMESTAMP(3),
ADD COLUMN     "checkFormalBy" TEXT,
ADD COLUMN     "checkSubstantiveAt" TIMESTAMP(3),
ADD COLUMN     "checkSubstantiveBy" TEXT,
ADD COLUMN     "directDebitByVendor" BOOLEAN NOT NULL DEFAULT false;
