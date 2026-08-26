-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiNoticeAckedAt" TIMESTAMP(3),
ADD COLUMN     "aiNoticeLoginCount" INTEGER NOT NULL DEFAULT 0;
