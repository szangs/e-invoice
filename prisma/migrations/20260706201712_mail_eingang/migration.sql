-- CreateTable
CREATE TABLE "MailIntake" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "invoiceId" TEXT,

    CONSTRAINT "MailIntake_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailIntake_tenantId_createdAt_idx" ON "MailIntake"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "MailIntake_createdAt_idx" ON "MailIntake"("createdAt");
