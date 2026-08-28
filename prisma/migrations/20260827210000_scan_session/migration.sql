-- Handy-als-Kamera-Kopplung (siehe schema.prisma, Modell-Kommentar ScanSession)
CREATE TABLE "ScanSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ScanSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScanSessionPhoto" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanSessionPhoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScanSession_token_key" ON "ScanSession"("token");
CREATE INDEX "ScanSession_tenantId_idx" ON "ScanSession"("tenantId");
CREATE INDEX "ScanSessionPhoto_sessionId_idx" ON "ScanSessionPhoto"("sessionId");

ALTER TABLE "ScanSession" ADD CONSTRAINT "ScanSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScanSession" ADD CONSTRAINT "ScanSession_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScanSessionPhoto" ADD CONSTRAINT "ScanSessionPhoto_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ScanSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
