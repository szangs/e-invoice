-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "pflichtangabenIgnoredAt" TIMESTAMP(3),
ADD COLUMN     "pflichtangabenIgnoredBy" TEXT,
ADD COLUMN     "pflichtangabenIgnoredReason" TEXT,
ADD COLUMN     "sellerCountryCode" TEXT,
ADD COLUMN     "taxRegion" TEXT;
