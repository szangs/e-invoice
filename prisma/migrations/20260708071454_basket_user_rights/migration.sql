/*
  Warnings:

  - You are about to drop the `BasketRolePermission` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "BasketRolePermission" DROP CONSTRAINT "BasketRolePermission_basketId_fkey";

-- DropTable
DROP TABLE "BasketRolePermission";

-- CreateTable
CREATE TABLE "BasketUserRight" (
    "id" TEXT NOT NULL,
    "basketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "right" "BasketRight" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BasketUserRight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BasketUserRight_basketId_userId_key" ON "BasketUserRight"("basketId", "userId");

-- AddForeignKey
ALTER TABLE "BasketUserRight" ADD CONSTRAINT "BasketUserRight_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "Basket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BasketUserRight" ADD CONSTRAINT "BasketUserRight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
