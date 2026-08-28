// Eigenes Poll-Intervall je Mandant (Stefan 2026-08-27, "bei Mailabholung
// müssen wir die Pollrate einstellen können") — gemeinsame Fälligkeits-Logik
// für alle drei Poll-basierten Abrufwege (graphMailin.ts/pop3Mailin.ts/
// imapMailin.ts). Die Poller-Prozesse selbst ticken in einem festen, feinen
// Grundtakt (siehe scripts/*-mailin-poller.ts); erst hier wird je Mandant
// entschieden, ob ein Abruf schon fällig ist — anhand von
// Tenant.mailInLastPolledAt + dessen eigenem mailInPollSeconds (leer =
// globaler Betreiber-Standard, z. B. MAIL_IN_GRAPH_POLL_SECONDS).
import { prisma } from '@/lib/db'

export function isMailinDue(
  tenant: { mailInPollSeconds: number | null; mailInLastPolledAt: Date | null },
  globalDefaultSeconds: number,
  now: Date = new Date(),
): boolean {
  if (!tenant.mailInLastPolledAt) return true
  const intervalSeconds = tenant.mailInPollSeconds && tenant.mailInPollSeconds > 0 ? tenant.mailInPollSeconds : globalDefaultSeconds
  return now.getTime() - tenant.mailInLastPolledAt.getTime() >= intervalSeconds * 1000
}

/** Nach jedem tatsächlichen Abrufversuch aufrufen (Erfolg wie Fehler) — auch beim manuellen "Jetzt abrufen" (setzt die Uhr sinnvollerweise ebenfalls zurück). Schlägt nie fehl (Fehler hier dürfen den Mail-Abruf selbst nicht stören). */
export async function markMailinPolled(tenantId: string, at: Date = new Date()): Promise<void> {
  await prisma.tenant.update({ where: { id: tenantId }, data: { mailInLastPolledAt: at } }).catch(() => undefined)
}
