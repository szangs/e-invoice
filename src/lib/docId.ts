// Eindeutige, lesbare Dokumenten-ID je Mandant: "<slug>-<laufende Nummer>"
// (z. B. "musterfirma-000001"). Der Zähler liegt in Tenant.nextDocSeq und
// wird per atomarem UPDATE ... SET nextDocSeq = nextDocSeq + 1 hochgezählt —
// Postgres serialisiert das auf Zeilenebene, sodass auch bei gleichzeitigen
// Uploads (Web-Upload, Scan, Extension, Mail-Eingang) keine Nummer doppelt
// vergeben wird.
import { prisma } from '@/lib/db'

export async function nextDocId(tenantId: string): Promise<string> {
  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: { nextDocSeq: { increment: 1 } },
    select: { nextDocSeq: true, slug: true },
  })
  return `${updated.slug}-${String(updated.nextDocSeq).padStart(6, '0')}`
}
