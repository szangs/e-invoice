// Bestand nachanalysieren: erkennt Format/Daten/Prüfstatus für Rechnungen,
// die vor Einführung der E-Rechnungs-Analyse eingegangen sind.
// Aufruf:  npx tsx scripts/reanalyze-invoices.ts
// Übernimmt Felder nur, wenn sie noch leer sind (manuelle Eingaben bleiben unberührt).
import { readFileSync } from 'fs'
import path from 'path'

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
import { analyzeInvoiceFile } from '../src/lib/erechnung'

async function main() {
  const invoices = await prisma.invoice.findMany({
    where: { docFormat: null, encrypted: false, fileName: { not: null } },
  })
  console.log(`${invoices.length} Rechnung(en) ohne Format-Analyse gefunden.`)
  let updated = 0
  for (const inv of invoices) {
    try {
      const filePath = path.join(process.cwd(), 'uploads', inv.tenantId, inv.fileName as string)
      const buffer = readFileSync(filePath)
      const a = await analyzeInvoiceFile(buffer, inv.mimeType ?? '', inv.originalName ?? '')
      const d = a.data
      // Elektronische Vorprüfung nachträglich abhaken, wenn jetzt erkannt als
      // gültige E-Rechnung — nur wenn noch nicht (manuell oder automatisch)
      // gesetzt, um bestehende Prüfstände nicht zu überschreiben.
      const autoElectronicOk = a.validation?.valid === true && !inv.checkElectronicAt
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          docFormat: a.format,
          xmlData: a.xml,
          validationOk: a.validation?.valid ?? null,
          validationIssues: a.validation?.missing.join(', ') || null,
          ...(autoElectronicOk
            ? { checkElectronicAt: new Date(), checkElectronicBy: 'System (automatische Prüfung)' }
            : {}),
          invoiceNumber: inv.invoiceNumber ?? d?.number ?? null,
          invoiceDate: inv.invoiceDate ?? (d?.issueDate ? new Date(d.issueDate) : null),
          dueDate: inv.dueDate ?? (d?.dueDate ? new Date(d.dueDate) : null),
          amountNet: inv.amountNet ?? d?.net ?? null,
          amountTax: inv.amountTax ?? d?.tax ?? null,
          amountGross: inv.amountGross ?? d?.gross ?? null,
          vendor: d?.sellerName && (inv.vendor === 'Unbekannt' || inv.vendor.includes('.')) ? d.sellerName : inv.vendor,
        },
      })
      console.log(`✓ ${inv.originalName ?? inv.id}: ${a.format}${a.validation ? (a.validation.valid ? ' · Pflichtangaben OK' : ' · unvollständig') : ''}`)
      updated++
    } catch (e) {
      console.log(`✗ ${inv.originalName ?? inv.id}: ${e instanceof Error ? e.message : 'Fehler'}`)
    }
  }
  console.log(`Fertig: ${updated} aktualisiert.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
