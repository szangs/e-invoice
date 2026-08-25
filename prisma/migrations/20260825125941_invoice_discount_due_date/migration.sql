-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "discountDueDate" TIMESTAMP(3),
ADD COLUMN     "discountPercent" DECIMAL(5,2);
