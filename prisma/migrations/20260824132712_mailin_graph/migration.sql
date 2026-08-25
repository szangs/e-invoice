-- AlterTable
ALTER TABLE "MailIntake" ADD COLUMN     "sourceMessageId" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "mailInGraphEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mailInGraphFolder" TEXT,
ADD COLUMN     "mailInGraphMailbox" TEXT;

-- CreateIndex
CREATE INDEX "MailIntake_tenantId_sourceMessageId_idx" ON "MailIntake"("tenantId", "sourceMessageId");
