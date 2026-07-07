// Bestand nachrüsten: vergibt allen Rechnungen ohne docId eine eindeutige
// Dokumenten-ID (<slug>-<laufende Nummer>), in Anlege-Reihenfolge (createdAt).
// Nutzt denselben Zähler (Tenant.nextDocSeq) wie Neuanlagen, damit später
// erfasste Belege garantiert höhere Nummern bekommen — keine Kollision.
// Aufruf:  npx tsx scripts/backfill-doc-ids.ts
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
import { prisma } from '../src/lib/db'
import { nextDocId } from '../src/lib/docId'

async function main() {
  const invoices = await prisma.invoice.findMany({
    where: { docId: null },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`${invoices.length} Rechnung(en) ohne Dokumenten-ID gefunden.`)
  let updated = 0
  for (const inv of invoices) {
    const docId = await nextDocId(inv.tenantId)
    await prisma.invoice.update({ where: { id: inv.id }, data: { docId } })
    console.log(`✓ ${inv.originalName ?? inv.id} → ${docId}`)
    updated++
  }
  console.log(`Fertig: ${updated} Dokumenten-ID(s) vergeben.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
