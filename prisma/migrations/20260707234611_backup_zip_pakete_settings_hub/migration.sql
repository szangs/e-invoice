-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "backupReminderDays" INTEGER DEFAULT 14,
ADD COLUMN     "backupWebdavPass" TEXT,
ADD COLUMN     "backupWebdavUrl" TEXT,
ADD COLUMN     "backupWebdavUser" TEXT;

-- CreateTable
CREATE TABLE "BackupPackage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "downloadToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "downloadedAt" TIMESTAMP(3),
    "lastReminderAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "remoteStoredAt" TIMESTAMP(3),
    "remoteError" TEXT,

    CONSTRAINT "BackupPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BackupPackage_downloadToken_key" ON "BackupPackage"("downloadToken");

-- CreateIndex
CREATE INDEX "BackupPackage_tenantId_createdAt_idx" ON "BackupPackage"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "BackupPackage_downloadedAt_idx" ON "BackupPackage"("downloadedAt");

-- AddForeignKey
ALTER TABLE "BackupPackage" ADD CONSTRAINT "BackupPackage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
