// Dubletten-Prüfung: erkennt doppelt eingegangene Rechnungen über
// (a) identische Beleg-Datei (SHA-256) oder (b) gleiche Rechnungsnummer + Lieferant.
import { createHash } from 'crypto'
import { prisma } from '@/lib/db'

export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export async function detectDuplicate(
  tenantId: string,
  opts: { fileHash?: string | null; invoiceNumber?: string | null; vendor?: string | null },
): Promise<string | null> {
  const or: object[] = []
  if (opts.fileHash) or.push({ fileHash: opts.fileHash })
  if (opts.invoiceNumber && opts.vendor) {
    or.push({ invoiceNumber: opts.invoiceNumber, vendor: opts.vendor })
  }
  if (or.length === 0) return null
  const original = await prisma.invoice.findFirst({
    // Gelöschte Rechnungen zählen nicht als "Original" — sonst ließe sich ein
    // absichtlich gelöschter Beleg nie erneut (regulär) erfassen.
    where: { tenantId, duplicateOfId: null, deletedAt: null, OR: or },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  return original?.id ?? null
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
