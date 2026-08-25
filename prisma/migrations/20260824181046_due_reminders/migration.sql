-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "dueReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "dueReminderDaysAfterReceipt" INTEGER,
ADD COLUMN     "dueReminderDaysBeforeDue" INTEGER;
