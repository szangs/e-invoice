-- Eigenes Mail-Abruf-Poll-Intervall je Mandant (Stefan 2026-08-27)
ALTER TABLE "Tenant" ADD COLUMN "mailInPollSeconds" INTEGER;
ALTER TABLE "Tenant" ADD COLUMN "mailInLastPolledAt" TIMESTAMP(3);
