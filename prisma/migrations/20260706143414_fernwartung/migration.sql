-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('REQUESTED', 'ACTIVE', 'ENDED', 'DECLINED');

-- CreateTable
CREATE TABLE "SupportSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "initiatedBy" TEXT NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,
    "snapshot" TEXT,
    "snapshotAt" TIMESTAMP(3),

    CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportSession_tenantId_status_idx" ON "SupportSession"("tenantId", "status");
