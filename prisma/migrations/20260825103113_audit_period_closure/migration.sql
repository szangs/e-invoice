-- CreateTable
CREATE TABLE "AuditPeriodClosure" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedByName" TEXT NOT NULL,
    "closedByEmail" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "firstEntryId" INTEGER,
    "lastEntryId" INTEGER NOT NULL,
    "chainHash" TEXT NOT NULL,

    CONSTRAINT "AuditPeriodClosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditPeriodClosure_year_key" ON "AuditPeriodClosure"("year");
