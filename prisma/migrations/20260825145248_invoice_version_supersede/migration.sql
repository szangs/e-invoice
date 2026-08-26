-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "supersededByInvoiceId" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "autoSupersedeInvoiceVersions" BOOLEAN NOT NULL DEFAULT false;
