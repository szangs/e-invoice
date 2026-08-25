-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "spamReplySentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "spamReplyEnabled" BOOLEAN NOT NULL DEFAULT false;
