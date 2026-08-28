-- Volltextsuche (Stefan 2026-08-27) — siehe Kommentare am Invoice.searchVector-
-- Feld und am InvoiceSearchToken-Modell in schema.prisma.

-- Unverschlüsselte Mandanten: generierte, immer aktuelle tsvector-Spalte über
-- die durchsuchbaren Klartext-Felder + GIN-Index darauf. GENERATED ALWAYS AS
-- ... STORED hält sich automatisch synchron (kein Trigger/Anwendungscode nötig).
ALTER TABLE "Invoice" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'german',
      coalesce("vendor", '') || ' ' ||
      coalesce("invoiceNumber", '') || ' ' ||
      coalesce("tags", '') || ' ' ||
      coalesce("notes", '') || ' ' ||
      coalesce("mailBodyText", '')
    )
  ) STORED;

CREATE INDEX "Invoice_searchVector_idx" ON "Invoice" USING GIN ("searchVector");

-- Verschlüsselte Mandanten: Blind-Index-Tabelle (Hash statt Klartext).
CREATE TABLE "InvoiceSearchToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,

    CONSTRAINT "InvoiceSearchToken_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceSearchToken_tenantId_token_idx" ON "InvoiceSearchToken"("tenantId", "token");
CREATE INDEX "InvoiceSearchToken_invoiceId_idx" ON "InvoiceSearchToken"("invoiceId");

ALTER TABLE "InvoiceSearchToken" ADD CONSTRAINT "InvoiceSearchToken_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceSearchToken" ADD CONSTRAINT "InvoiceSearchToken_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
