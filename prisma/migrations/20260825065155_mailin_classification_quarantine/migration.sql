-- AlterEnum
ALTER TYPE "BasketKind" ADD VALUE 'QUARANTINE';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "invoiceClass" TEXT;
