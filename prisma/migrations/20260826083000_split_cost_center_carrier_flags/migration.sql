-- Kostenstellen/Kostenträger: EIN gemeinsamer Schalter -> zwei unabhängige
-- Schalter (Stefan 2026-08-26). Bestehender Wert wird auf beide neuen Spalten
-- übernommen, damit sich am sichtbaren Verhalten für bestehende Mandanten
-- nichts ändert.
ALTER TABLE "Tenant" ADD COLUMN "costCenterEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "costCarrierEnabled" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Tenant" SET "costCenterEnabled" = "costCentersEnabled", "costCarrierEnabled" = "costCentersEnabled";
ALTER TABLE "Tenant" DROP COLUMN "costCentersEnabled";
