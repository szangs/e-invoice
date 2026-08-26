-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "senderEmail" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_tenantId_senderEmail_idx" ON "Invoice"("tenantId", "senderEmail");
