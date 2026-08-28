-- Perioden-Abschluss je Mandant (Stefan 2026-08-27, "gehört zum Mandanten,
-- nicht ins Betreiber-Cockpit"). Keine bestehenden Zeilen in AuditPeriodClosure
-- (geprüft vor der Migration) -> tenantId kann direkt NOT NULL angelegt werden.

-- Alte, systemweite Eindeutigkeit auf year auflösen
DROP INDEX IF EXISTS "AuditPeriodClosure_year_key";

ALTER TABLE "AuditPeriodClosure" ADD COLUMN "tenantId" TEXT NOT NULL;

ALTER TABLE "AuditPeriodClosure"
  ADD CONSTRAINT "AuditPeriodClosure_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "AuditPeriodClosure_tenantId_year_key" ON "AuditPeriodClosure"("tenantId", "year");
