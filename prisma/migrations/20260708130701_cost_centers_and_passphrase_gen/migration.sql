-- CreateEnum
CREATE TYPE "CostCodeKind" AS ENUM ('KOSTENSTELLE', 'KOSTENTRAEGER');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "costCarrierCode" TEXT,
ADD COLUMN     "costCenterCode" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "costCentersEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CostCode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "CostCodeKind" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostCode_tenantId_kind_idx" ON "CostCode"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CostCode_tenantId_kind_code_key" ON "CostCode"("tenantId", "kind", "code");

-- AddForeignKey
ALTER TABLE "CostCode" ADD CONSTRAINT "CostCode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
