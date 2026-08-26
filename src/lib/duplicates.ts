// Dubletten-Prüfung: erkennt doppelt eingegangene Rechnungen über
// (a) identische Beleg-Datei (SHA-256) oder (b) gleiche Rechnungsnummer + Lieferant.
import { createHash } from 'crypto'
import { prisma } from '@/lib/db'

export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export type DuplicateMatch = {
  id: string
  // 100 % sicher (Stefan 2026-08-25): identische Beleg-Datei (SHA-256-Treffer)
  // — im Unterschied zum schwächeren Abgleich über Rechnungsnummer+Lieferant,
  // der theoretisch (wenn auch selten) auch bei zwei tatsächlich
  // unterschiedlichen Belegen anschlagen könnte (z. B. wiederverwendete
  // Rechnungsnummer, Korrektur-/Ersatzbeleg). Nur bei exact=true darf
  // automatisch gelöscht werden (Tenant.autoDeleteExactDuplicates).
  exact: boolean
}

export async function detectDuplicate(
  tenantId: string,
  opts: { fileHash?: string | null; invoiceNumber?: string | null; vendor?: string | null },
): Promise<DuplicateMatch | null> {
  // Datei-Hash zuerst und separat geprüft (statt in einem gemeinsamen OR):
  // nur so lässt sich hinterher sagen, ÜBER WELCHEN Weg der Treffer kam.
  if (opts.fileHash) {
    const exact = await prisma.invoice.findFirst({
      where: { tenantId, duplicateOfId: null, deletedAt: null, fileHash: opts.fileHash },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (exact) return { id: exact.id, exact: true }
  }
  if (opts.invoiceNumber && opts.vendor) {
    // Gelöschte Rechnungen zählen nicht als "Original" — sonst ließe sich ein
    // absichtlich gelöschter Beleg nie erneut (regulär) erfassen.
    const heuristic = await prisma.invoice.findFirst({
      where: { tenantId, duplicateOfId: null, deletedAt: null, invoiceNumber: opts.invoiceNumber, vendor: opts.vendor },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (heuristic) return { id: heuristic.id, exact: false }
  }
  return null
}

export type DuplicateCandidate = {
  id: string
  docId: string | null
  vendor: string
  invoiceNumber: string | null
  createdAt: string
}

/**
 * Wie detectDuplicate, aber mit Anzeige-Informationen für eine Vorab-Bestätigung
 * ("möchten Sie diese Rechnung wirklich noch einmal übernehmen?") VOR dem
 * eigentlichen Speichern — Stefan 2026-07-08.
 */
export async function findDuplicateInvoice(
  tenantId: string,
  opts: { fileHash?: string | null; invoiceNumber?: string | null; vendor?: string | null },
): Promise<DuplicateCandidate | null> {
  const or: object[] = []
  if (opts.fileHash) or.push({ fileHash: opts.fileHash })
  if (opts.invoiceNumber && opts.vendor) {
    or.push({ invoiceNumber: opts.invoiceNumber, vendor: opts.vendor })
  }
  if (or.length === 0) return null
  const original = await prisma.invoice.findFirst({
    where: { tenantId, duplicateOfId: null, deletedAt: null, OR: or },
    orderBy: { createdAt: 'asc' },
    select: { id: true, docId: true, vendor: true, invoiceNumber: true, createdAt: true },
  })
  if (!original) return null
  return {
    id: original.id,
    docId: original.docId,
    vendor: original.vendor,
    invoiceNumber: original.invoiceNumber,
    createdAt: original.createdAt.toISOString(),
  }
}
