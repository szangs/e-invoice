-- AlterTable
ALTER TABLE "InvoiceNote" ADD COLUMN     "doneAt" TIMESTAMP(3),
ADD COLUMN     "doneBy" TEXT,
ADD COLUMN     "subject" TEXT;
