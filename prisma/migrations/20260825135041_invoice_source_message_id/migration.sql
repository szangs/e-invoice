-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "sourceMessageId" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_tenantId_sourceMessageId_idx" ON "Invoice"("tenantId", "sourceMessageId");
