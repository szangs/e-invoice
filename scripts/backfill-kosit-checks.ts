// Bestand nachrüsten (Stefan 2026-08-26): führt die offizielle KoSIT-Prüfung
// einmalig für alle bereits abgelegten E-Rechnungen (xmlData vorhanden) nach,
// die noch kein Ergebnis haben — seit der Einführung der automatischen
// Hintergrund-Prüfung (lib/kositValidator.ts scheduleKositCheck) läuft das
// nur noch für NEU eingehende Rechnungen automatisch.
// Aufruf:  npx tsx scripts/backfill-kosit-checks.ts
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
import { isKositInstalled } from '../src/lib/kositSetup'
import { runAndStoreKositCheck } from '../src/lib/kositValidator'

async function main() {
  if (!isKositInstalled()) {
    console.error('KoSIT-Validator ist nicht installiert — bitte zuerst im Betreiber-Cockpit einrichten.')
    process.exit(1)
  }
  const invoices = await prisma.invoice.findMany({
    where: { kositCheckedAt: null, xmlData: { not: null }, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, vendor: true, invoiceNumber: true },
  })
  console.log(`${invoices.length} E-Rechnung(en) ohne KoSIT-Ergebnis gefunden.`)
  let ok = 0
  let failed = 0
  for (const inv of invoices) {
    try {
      const result = await runAndStoreKositCheck(inv.id)
      const verdict = result?.accepted === true ? 'akzeptabel' : result?.accepted === false ? 'zurückgewiesen' : 'unklar'
      console.log(`✓ ${inv.vendor} ${inv.invoiceNumber ?? ''} (${inv.id}) → ${verdict}`)
      ok++
    } catch (e) {
      console.error(`✗ ${inv.vendor} ${inv.invoiceNumber ?? ''} (${inv.id}):`, e instanceof Error ? e.message : e)
      failed++
    }
  }
  console.log(`Fertig: ${ok} geprüft, ${failed} fehlgeschlagen.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
