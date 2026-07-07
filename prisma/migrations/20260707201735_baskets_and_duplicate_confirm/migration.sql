-- CreateEnum
CREATE TYPE "BasketKind" AS ENUM ('INBOX', 'HANDOVER', 'CUSTOM');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "basketId" TEXT;

-- CreateTable
CREATE TABLE "Basket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BasketKind" NOT NULL DEFAULT 'CUSTOM',
    "position" INTEGER NOT NULL DEFAULT 0,
    "fourEyesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notificationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notificationIntervalHours" INTEGER,
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Basket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BasketMember" (
    "id" TEXT NOT NULL,
    "basketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BasketMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BasketApproval" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "fromBasketId" TEXT NOT NULL,
    "targetBasketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BasketApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Basket_tenantId_kind_idx" ON "Basket"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "BasketMember_basketId_userId_key" ON "BasketMember"("basketId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BasketApproval_invoiceId_fromBasketId_targetBasketId_userId_key" ON "BasketApproval"("invoiceId", "fromBasketId", "targetBasketId", "userId");

-- CreateIndex
CREATE INDEX "Invoice_basketId_idx" ON "Invoice"("basketId");

-- AddForeignKey
ALTER TABLE "Basket" ADD CONSTRAINT "Basket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketMember" ADD CONSTRAINT "BasketMember_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "Basket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketMember" ADD CONSTRAINT "BasketMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketApproval" ADD CONSTRAINT "BasketApproval_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketApproval" ADD CONSTRAINT "BasketApproval_fromBasketId_fkey" FOREIGN KEY ("fromBasketId") REFERENCES "Basket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketApproval" ADD CONSTRAINT "BasketApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "Basket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
