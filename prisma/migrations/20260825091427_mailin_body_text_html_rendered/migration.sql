-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "htmlRendered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mailBodyText" TEXT;
