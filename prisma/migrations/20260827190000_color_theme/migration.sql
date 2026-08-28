-- Erscheinungsbild / Farbschema je Mandant (Stefan 2026-08-27)
ALTER TABLE "Tenant" ADD COLUMN "colorTheme" TEXT NOT NULL DEFAULT 'marine';
