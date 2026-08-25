// Perioden-Abschluss des Audit-Protokolls (Stefan 2026-08-25, §18): sealt
// ein Kalenderjahr anhand der bestehenden Hash-Kette (lib/audit.ts) — der
// Hash des letzten Eintrags der Periode bezeugt kryptografisch bereits ALLE
// vorangegangenen Einträge. System-weit (AuditLog ist nicht mandanten-
// gebunden), daher wirkt ein Abschluss auf ALLE Mandanten gleichzeitig:
// Belege, deren Eingang (createdAt) in ein abgeschlossenes Jahr fällt,
// gelten als GESPERRT (siehe isInvoiceLockedByClosure) — keine Änderung,
// kein Verschieben, kein Löschen mehr möglich (lib/baskets.ts requestMove,
// api/invoices/[id]/route.ts). Einmal abgeschlossen, unveränderlich.
import { prisma } from '@/lib/db'

/** Liefert alle bereits abgeschlossenen Jahre als Set — für schnelle Prüfung ohne N+1-Anfragen bei Listen. */
export async function getClosedYears(): Promise<Set<number>> {
  const rows = await prisma.auditPeriodClosure.findMany({ select: { year: true } })
  return new Set(rows.map((r) => r.year))
}

/** Prüft, ob EIN Beleg gesperrt ist (Detailseite/API — kein Set nötig). */
export async function isInvoiceLockedByClosure(createdAt: Date): Promise<boolean> {
  const year = createdAt.getFullYear()
  const closure = await prisma.auditPeriodClosure.findUnique({ where: { year }, select: { id: true } })
  return Boolean(closure)
}
