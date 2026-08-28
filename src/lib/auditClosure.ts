// Perioden-Abschluss des Audit-Protokolls (Stefan 2026-08-25, §18): sealt
// ein Kalenderjahr anhand der bestehenden Hash-Kette (lib/audit.ts) — der
// Hash des letzten Eintrags der Periode bezeugt kryptografisch bereits ALLE
// vorangegangenen Einträge. Der Abschluss-DATENSATZ ist seit 2026-08-27 je
// MANDANT (Review-Fund "gehört zum Mandanten, nicht ins Betreiber-Cockpit"):
// jeder Mandant schließt sein eigenes Jahr unabhängig ab. Die zugrunde
// liegende Hash-Kette (AuditLog) bleibt bewusst EINE einzige, mandanten-
// übergreifende Kette (siehe Kommentar am AuditPeriodClosure-Modell in
// schema.prisma). Belege, deren Eingang (createdAt) in ein für DIESEN
// Mandanten abgeschlossenes Jahr fällt, gelten als GESPERRT (siehe
// isInvoiceLockedByClosure) — keine Änderung, kein Verschieben, kein Löschen
// mehr möglich (lib/baskets.ts requestMove, api/invoices/[id]/route.ts).
// Einmal abgeschlossen, unveränderlich.
import { prisma } from '@/lib/db'

/** Liefert alle bereits abgeschlossenen Jahre EINES Mandanten als Set — für schnelle Prüfung ohne N+1-Anfragen bei Listen. */
export async function getClosedYears(tenantId: string): Promise<Set<number>> {
  const rows = await prisma.auditPeriodClosure.findMany({ where: { tenantId }, select: { year: true } })
  return new Set(rows.map((r) => r.year))
}

/** Prüft, ob EIN Beleg DIESES Mandanten gesperrt ist (Detailseite/API — kein Set nötig). */
export async function isInvoiceLockedByClosure(tenantId: string, createdAt: Date): Promise<boolean> {
  const year = createdAt.getFullYear()
  const closure = await prisma.auditPeriodClosure.findUnique({
    where: { tenantId_year: { tenantId, year } },
    select: { id: true },
  })
  return Boolean(closure)
}
