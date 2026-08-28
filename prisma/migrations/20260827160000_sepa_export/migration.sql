-- Zahlungsverkehr / SEPA-Sammelüberweisung (Stefan 2026-08-27)
ALTER TABLE "VendorAddress" ALTER COLUMN "address" DROP NOT NULL;
ALTER TABLE "VendorAddress" ADD COLUMN "iban" TEXT;
ALTER TABLE "VendorAddress" ADD COLUMN "bic" TEXT;
ALTER TABLE "VendorAddress" ADD COLUMN "ibanVerifiedAt" TIMESTAMP(3);
ALTER TABLE "VendorAddress" ADD COLUMN "ibanVerifiedBy" TEXT;

ALTER TABLE "Tenant" ADD COLUMN "sepaOwnName" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "sepaOwnIban" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "sepaOwnBic" TEXT;
