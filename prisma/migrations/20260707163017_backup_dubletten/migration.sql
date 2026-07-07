-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "duplicateOfId" TEXT,
ADD COLUMN     "fileHash" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "backupEmail" TEXT,
ADD COLUMN     "backupFrequency" TEXT,
ADD COLUMN     "lastBackupAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Invoice_tenantId_fileHash_idx" ON "Invoice"("tenantId", "fileHash");
