// Bestand nachrüsten: setzt für alle Rechnungen ohne Korb (basketId null —
// angelegt vor Einführung der Körbe-Funktion) den Eingangskorb (INBOX) des
// jeweiligen Mandanten. Legt den Eingangs-/Übergabekorb an, falls ein
// Mandant noch keine Körbe hat.
// Aufruf:  npx tsx scripts/backfill-baskets.ts
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
    where: { basketId: null },
    select: { id: true, tenantId: true, vendor: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`${invoices.length} Rechnung(en) ohne Korb gefunden.`)
  const inboxByTenant = new Map<string, string>()
  let updated = 0
  for (const inv of invoices) {
    let inboxId = inboxByTenant.get(inv.tenantId)
    if (!inboxId) {
      inboxId = (await ensureSystemBaskets(inv.tenantId)).inboxId
      inboxByTenant.set(inv.tenantId, inboxId)
    }
    await prisma.invoice.update({ where: { id: inv.id }, data: { basketId: inboxId } })
    console.log(`✓ ${inv.vendor} (${inv.id}) → Eingangskorb`)
    updated++
  }
  console.log(`Fertig: ${updated} Rechnung(en) dem Eingangskorb zugeordnet.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
