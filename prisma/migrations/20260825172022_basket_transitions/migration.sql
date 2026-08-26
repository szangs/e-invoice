-- CreateTable
CREATE TABLE "BasketTransition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromBasketId" TEXT NOT NULL,
    "toBasketId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BasketTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BasketTransition_tenantId_idx" ON "BasketTransition"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BasketTransition_fromBasketId_toBasketId_key" ON "BasketTransition"("fromBasketId", "toBasketId");

-- AddForeignKey
ALTER TABLE "BasketTransition" ADD CONSTRAINT "BasketTransition_fromBasketId_fkey" FOREIGN KEY ("fromBasketId") REFERENCES "Basket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketTransition" ADD CONSTRAINT "BasketTransition_toBasketId_fkey" FOREIGN KEY ("toBasketId") REFERENCES "Basket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
