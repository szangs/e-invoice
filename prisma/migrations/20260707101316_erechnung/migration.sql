-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "docFormat" TEXT,
ADD COLUMN     "validationIssues" TEXT,
ADD COLUMN     "validationOk" BOOLEAN,
ADD COLUMN     "xmlData" TEXT;
