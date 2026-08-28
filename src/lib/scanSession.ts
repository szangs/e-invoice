// Handy-als-Kamera-Kopplung (Stefan 2026-08-27) — siehe Modell-Kommentar
// ScanSession in schema.prisma für das Gesamtkonzept (QR-Code am PC, Foto-
// Upload vom Handy ohne eigenen Login, Zero-Knowledge bei aktiver
// Verschlüsselung über einen sitzungseigenen Einmal-Schlüssel).
import { randomUUID } from 'crypto'
import { ApiError } from '@/lib/context'
import { prisma } from '@/lib/db'
import { deleteScanSessionFiles } from '@/lib/storage'

export const SCAN_SESSION_TTL_MINUTES = 15
export const MAX_PHOTOS_PER_SESSION = 30
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024 // etwas großzügiger als MAX_FILE_BYTES — verschlüsselte Fotos haben etwas Overhead

export function newScanSessionToken(): string {
  // Gleiches Zufallsniveau wie LoginTicket.code — der Token IST hier das
  // einzige Zugangsmerkmal (kein zusätzlicher Login), muss also praktisch
  // unerratbar sein.
  return randomUUID()
}

/**
 * Lädt eine ScanSession per Token und prüft Gültigkeit (nicht abgelaufen,
 * nicht geschlossen). Räumt eine bereits abgelaufene/geschlossene Sitzung
 * bei dieser Gelegenheit gleich mit auf (kein eigener Cron-Job nötig — die
 * Sitzungen sind ohnehin kurzlebig, Aufräumen "on access" reicht aus).
 * Wirft ApiError(410), wenn der Token nicht (mehr) gültig ist.
 */
export async function getValidScanSession(token: string) {
  const session = await prisma.scanSession.findUnique({ where: { token } })
  if (!session) throw new ApiError(410, 'Diese Sitzung wurde nicht gefunden oder ist bereits beendet.')
  if (session.closedAt || session.expiresAt.getTime() < Date.now()) {
    await closeScanSession(session.id, session.tenantId)
    throw new ApiError(410, 'Diese Sitzung ist abgelaufen. Bitte am PC einen neuen Code erzeugen.')
  }
  return session
}

/** Löscht Fotos+Dateien und markiert die Sitzung als geschlossen. */
export async function closeScanSession(sessionId: string, tenantId: string): Promise<void> {
  await deleteScanSessionFiles(tenantId, sessionId)
  await prisma.scanSession.update({ where: { id: sessionId }, data: { closedAt: new Date() } }).catch(() => undefined)
}
