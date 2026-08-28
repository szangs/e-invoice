-- "Zur Prüfung weitergeben" (Stefan 2026-08-27)
ALTER TABLE "InvoiceNote" ADD COLUMN "isHandoff" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "InvoiceNote_invoiceId_isHandoff_doneAt_idx" ON "InvoiceNote"("invoiceId", "isHandoff", "doneAt");
