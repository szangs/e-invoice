-- AlterTable
ALTER TABLE "Tenant" DROP COLUMN "dueReminderDaysAfterReceipt",
DROP COLUMN "dueReminderDaysBeforeDue";

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "dueReminderSentAt";
