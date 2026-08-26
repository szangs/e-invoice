// Bestand nachrüsten (Stefan 2026-08-26, "sollen wir sowas nicht einfach in
// die Ablage verschieben?"): verschiebt bereits schreibgeschützte, durch eine
// neuere Version ersetzte Rechnungen (Invoice.supersededAt gesetzt) nachträglich
// in die Ablage — seit der Einführung des Auto-Verschiebens (lib/mailin.ts)
// gilt das nur für NEU eintreffende Versionierungsfälle automatisch.
// Aufruf:  npx tsx scripts/backfill-superseded-to-archive.ts
import { readFileSync } from 'fs'

try {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
} catch {
  /* optional */
}

/* eslint-disable import/first */
import { ensureSystemBaskets } from '../src/lib/baskets'
import { prisma } from '../src/lib/db'

async function main() {
  const invoices = await prisma.invoice.findMany({
    where: { supersededAt: { not: null }, deletedAt: null },
    select: { id: true, tenantId: true, vendor: true, invoiceNumber: true, basketId: true },
  })
  console.log(`${invoices.length} schreibgeschützte, ersetzte Rechnung(en) gefunden.`)
  const archiveByTenant = new Map<string, string>()
  let moved = 0
  let skipped = 0
  for (const inv of invoices) {
    let archiveId = archiveByTenant.get(inv.tenantId)
    if (!archiveId) {
      archiveId = (await ensureSystemBaskets(inv.tenantId)).archiveId
      archiveByTenant.set(inv.tenantId, archiveId)
    }
    if (inv.basketId === archiveId) {
      skipped++
      continue
    }
    await prisma.invoice.update({ where: { id: inv.id }, data: { basketId: archiveId } })
    console.log(`✓ ${inv.vendor} ${inv.invoiceNumber ?? ''} (${inv.id}) → Ablage`)
    moved++
  }
  console.log(`Fertig: ${moved} verschoben, ${skipped} lagen bereits in der Ablage.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
