-- CreateEnum
CREATE TYPE "BasketRight" AS ENUM ('VIEW', 'CONTENT', 'MOVE', 'APPROVE', 'HANDOVER', 'FIBU');

-- CreateTable
CREATE TABLE "BasketRolePermission" (
    "id" TEXT NOT NULL,
    "basketId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "right" "BasketRight" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BasketRolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BasketRolePermission_basketId_role_key" ON "BasketRolePermission"("basketId", "role");

-- AddForeignKey
ALTER TABLE "BasketRolePermission" ADD CONSTRAINT "BasketRolePermission_basketId_fkey" FOREIGN KEY ("basketId") REFERENCES "Basket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
