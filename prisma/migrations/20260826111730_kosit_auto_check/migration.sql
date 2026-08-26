-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "kositAccepted" BOOLEAN,
ADD COLUMN     "kositCheckedAt" TIMESTAMP(3),
ADD COLUMN     "kositMessages" JSONB,
ADD COLUMN     "kositScenario" TEXT;
