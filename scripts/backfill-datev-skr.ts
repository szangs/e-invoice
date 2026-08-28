// Bestand nachrüsten (Stefan 2026-08-26, Review-Fund "neue Pflichteinstellung
// kann Bestandsmandanten aussperren"): datevSkr ist seit heute Pflichtfeld
// für den DATEV-Export (siehe lib/datev.ts validateDatevSettings), hat aber
// bei Mandanten ohne bewusst gespeicherte Einstellung noch den alten Wert
// NULL — der DB-Default "SKR04" (Migration datev_skr_default) gilt nur für
// NEU angelegte Mandanten. Setzt SKR04 (der bisherige reine Anzeige-
// Fallback, siehe admin/settings/page.tsx) auch für Bestandsmandanten.
// Aufruf:  npx tsx scripts/backfill-datev-skr.ts
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

async function main() {
  const result = await prisma.tenant.updateMany({
    where: { datevSkr: null },
    data: { datevSkr: 'SKR04' },
  })
  console.log(`${result.count} Mandant(en) auf SKR04 nachgezogen.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
