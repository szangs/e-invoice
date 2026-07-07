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
    where: { tenantId, duplicateOfId: null, OR: or },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  return original?.id ?? null
}
