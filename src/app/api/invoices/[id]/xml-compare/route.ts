// Plausibilitätsabgleich (Stefan 2026-07-08): bei ZUGFeRD/Factur-X steckt
// neben dem sichtbaren PDF-Bild ein maschinenlesbares XML im selben Beleg.
// Beide MÜSSEN dieselben Werte zeigen — dieser Button liest das PDF-BILD per
// KI-Bilderkennung (wie bei einem Foto-Scan) und vergleicht das Ergebnis mit
// den aus dem XML übernommenen (gesperrten) Feldern. Weicht etwas ab, könnte
// das PDF nachträglich verändert oder das XML fehlerhaft erzeugt worden sein
// — beides ein Warnsignal, das ein Mensch prüfen sollte. Ändert NICHTS an den
// gespeicherten Daten (nur Anzeige), die XML-Sperre (PATCH .../invoices/[id])
// bleibt unberührt.
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { extractInvoiceFromImage } from '@/lib/aiExtract'
import { audit } from '@/lib/audit'
import { requireInvoiceContentAccess } from '@/lib/basketRights'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { rasterizeFirstPage } from '@/lib/pdfRaster'
import { readInvoiceFile } from '@/lib/storage'

type Deviation = { field: string; label: string; xmlValue: string; aiValue: string }

function isoDate(d: Date | null): string {
  if (!d) return ''
  return d.toISOString().slice(0, 10)
}

function normText(s: string | null): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function amountsDiffer(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return false
  if (a === null || b === null) return true
  return Math.abs(a - b) > 0.02
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant?.aiAllowed) throw new ApiError(403, 'KI-Funktionen sind für Ihren Mandanten deaktiviert.')

    const invoice = await prisma.invoice.findFirst({ where: { id: params.id, tenantId } })
    if (!invoice) throw new ApiError(404, 'Rechnung nicht gefunden.')
    await requireInvoiceContentAccess(ctx, invoice.basketId)
    if (!invoice.fileName) throw new ApiError(404, 'Kein Beleg vorhanden.')
    if (invoice.encrypted) {
      throw new ApiError(403, 'Bei verschlüsselten Belegen nicht verfügbar (Zero-Knowledge).')
    }
    // Der Abgleich braucht ein sichtbares PDF-Bild MIT eingebettetem XML —
    // das trifft nur auf ZUGFeRD/Factur-X zu (XRechnung ist reines XML ohne
    // eigenes Rechnungsbild, dort gibt es nichts zum Gegenprüfen).
    if (invoice.docFormat !== 'ZUGFERD') {
      throw new ApiError(400, 'Der Bild-Abgleich funktioniert nur bei ZUGFeRD/Factur-X (PDF mit eingebettetem XML).')
    }
    if (invoice.mimeType !== 'application/pdf') {
      throw new ApiError(400, 'Der Beleg ist keine PDF-Datei.')
    }

    const buffer = await readInvoiceFile(tenantId, invoice.fileName)
    const png = await rasterizeFirstPage(buffer)
    if (!png) throw new ApiError(422, 'PDF konnte nicht für die KI-Erkennung gerastert werden.')

    const ai = await extractInvoiceFromImage(png.toString('base64'), 'image/png')

    const xmlVendor = invoice.vendor ?? ''
    const xmlNumber = invoice.invoiceNumber ?? ''
    const xmlInvoiceDate = isoDate(invoice.invoiceDate)
    const xmlDueDate = isoDate(invoice.dueDate)
    const xmlNet = invoice.amountNet !== null ? Number(invoice.amountNet) : null
    const xmlTax = invoice.amountTax !== null ? Number(invoice.amountTax) : null
    const xmlGross = invoice.amountGross !== null ? Number(invoice.amountGross) : null
    const xmlCurrency = invoice.currency ?? ''

    const deviations: Deviation[] = []
    const add = (field: string, label: string, xmlValue: string, aiValue: string) =>
      deviations.push({ field, label, xmlValue: xmlValue || '—', aiValue: aiValue || '—' })

    if (normText(xmlVendor) !== normText(ai.vendor) && ai.vendor) {
      add('vendor', 'Lieferant', xmlVendor, ai.vendor)
    }
    if (normText(xmlNumber) !== normText(ai.invoiceNumber) && ai.invoiceNumber) {
      add('invoiceNumber', 'Rechnungsnummer', xmlNumber, ai.invoiceNumber)
    }
    if (ai.invoiceDate && xmlInvoiceDate && ai.invoiceDate.slice(0, 10) !== xmlInvoiceDate) {
      add('invoiceDate', 'Rechnungsdatum', xmlInvoiceDate, ai.invoiceDate)
    }
    if (ai.dueDate && xmlDueDate && ai.dueDate.slice(0, 10) !== xmlDueDate) {
      add('dueDate', 'Fälligkeit', xmlDueDate, ai.dueDate)
    }
    if (ai.amountNet !== null && amountsDiffer(xmlNet, ai.amountNet)) {
      add('amountNet', 'Netto', xmlNet !== null ? String(xmlNet) : '', String(ai.amountNet))
    }
    if (ai.amountTax !== null && amountsDiffer(xmlTax, ai.amountTax)) {
      add('amountTax', 'Steuer', xmlTax !== null ? String(xmlTax) : '', String(ai.amountTax))
    }
    if (ai.amountGross !== null && amountsDiffer(xmlGross, ai.amountGross)) {
      add('amountGross', 'Brutto', xmlGross !== null ? String(xmlGross) : '', String(ai.amountGross))
    }
    if (ai.currency && normText(xmlCurrency) !== normText(ai.currency)) {
      add('currency', 'Währung', xmlCurrency, ai.currency)
    }

    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'AI_EXTRACT',
      details:
        `Bild-Abgleich (KI vs. XML) für Rechnung ${invoice.id}: ` +
        (deviations.length === 0 ? 'keine Abweichungen' : `${deviations.length} Abweichung(en)`),
    })

    return NextResponse.json({ ok: true, deviations, checkedAt: new Date().toISOString() })
  } catch (e) {
    return jsonError(e)
  }
}
