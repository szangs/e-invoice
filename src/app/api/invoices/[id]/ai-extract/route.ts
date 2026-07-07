// KI-gestützte Datenerkennung NACHTRÄGLICH auf einem bereits gespeicherten
// Beleg (z. B. ein früher gescanntes Foto oder eine "nackte" PDF ohne
// KI-Erfassung). Nutzt denselben KI-Anbieter/dieselben Regeln wie beim Scan
// selbst (/api/invoices/ai-extract): nur wenn der Mandant KI erlaubt UND
// dieser konkrete Beleg unverschlüsselt ist (Zero-Knowledge). Bei ZUGFeRD/
// XRechnung wird KI bewusst NICHT angeboten — die Daten sind dort schon
// strukturiert aus dem eingebetteten XML gelesen. Bei "nackter" PDF wird die
// erste Seite serverseitig gerastert (lib/pdfRaster.ts), bevor sie an die
// Vision-KI geht.
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { extractInvoiceFromImage } from '@/lib/aiExtract'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { EINVOICE_FORMATS } from '@/lib/erechnung'
import { rasterizeFirstPage } from '@/lib/pdfRaster'
import { readInvoiceFile } from '@/lib/storage'

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp']

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant?.aiAllowed) throw new ApiError(403, 'KI-Funktionen sind für Ihren Mandanten deaktiviert.')

    const invoice = await prisma.invoice.findFirst({ where: { id: params.id, tenantId } })
    if (!invoice?.fileName) throw new ApiError(404, 'Kein Beleg vorhanden.')
    if (invoice.encrypted) {
      throw new ApiError(403, 'Bei verschlüsselten Belegen nicht verfügbar (Zero-Knowledge).')
    }
    if (invoice.docFormat && EINVOICE_FORMATS.includes(invoice.docFormat as (typeof EINVOICE_FORMATS)[number])) {
      throw new ApiError(400, 'ZUGFeRD/XRechnung wurden bereits strukturiert erkannt — KI-Erkennung nicht nötig.')
    }
    const isImage = invoice.mimeType && IMAGE_MIMES.includes(invoice.mimeType)
    const isPdf = invoice.mimeType === 'application/pdf'
    if (!isImage && !isPdf) {
      throw new ApiError(400, 'KI-Erkennung funktioniert nur bei Foto-Belegen (PNG/JPG/WebP) oder PDF.')
    }

    const buffer = await readInvoiceFile(tenantId, invoice.fileName)
    let base64: string
    let mimeType: string
    if (isPdf) {
      const png = await rasterizeFirstPage(buffer)
      if (!png) throw new ApiError(422, 'PDF konnte nicht für die KI-Erkennung gerastert werden.')
      base64 = png.toString('base64')
      mimeType = 'image/png'
    } else {
      base64 = buffer.toString('base64')
      mimeType = invoice.mimeType as string
    }
    const data = await extractInvoiceFromImage(base64, mimeType)
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'AI_EXTRACT',
      details: `KI-Datenerkennung nachträglich ausgeführt (Rechnung ${invoice.id})`,
    })
    return NextResponse.json({ ok: true, data })
  } catch (e) {
    return jsonError(e)
  }
}
