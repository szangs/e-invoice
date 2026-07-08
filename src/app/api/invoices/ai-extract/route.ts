// KI-gestützte Datenerkennung VOR dem Speichern — sowohl beim "Papierrechnung
// scannen" (Foto) als auch beim elektronischen Hochladen einer "nackten" PDF
// (kein ZUGFeRD/XRechnung, siehe RE02a-Formular: Format wird dort sofort nach
// Dateiauswahl per /api/invoices/detect-format erkannt). Serverseitig
// erzwungen: nur wenn der Mandant KI-Funktionen erlaubt. Die Datei kommt hier
// ohnehin direkt vom Client (noch vor jeder Verschlüsselung/Speicherung) —
// wird nur transient an den KI-Anbieter weitergereicht, nie persistiert oder
// geloggt (Stefan 2026-07-09: auch bei aktiver Beleg-Verschlüsselung nutzbar,
// siehe /api/ai/config). PDFs werden vor dem Versand an die Vision-KI
// serverseitig zu einem Bild gerastert (lib/pdfRaster.ts).
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { extractInvoiceFromImage } from '@/lib/aiExtract'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { hasFeature } from '@/lib/license'
import { rasterizeFirstPage } from '@/lib/pdfRaster'

const MAX_BYTES = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant?.aiAllowed) throw new ApiError(403, 'KI-Funktionen sind für Ihren Mandanten deaktiviert.')
    if (!tenant || !hasFeature(tenant, 'AI')) throw new ApiError(403, 'KI-Erkennung ist im aktuellen Tarif nicht enthalten.')
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, 'Keine Datei erhalten.')
    if (file.size > MAX_BYTES) throw new ApiError(400, 'Datei zu groß (max. 10 MB).')
    let base64: string
    let mimeType: string
    if (file.type === 'application/pdf') {
      const png = await rasterizeFirstPage(Buffer.from(await file.arrayBuffer()))
      if (!png) throw new ApiError(422, 'PDF konnte nicht für die KI-Erkennung gerastert werden.')
      base64 = png.toString('base64')
      mimeType = 'image/png'
    } else {
      base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
      mimeType = file.type || 'image/jpeg'
    }
    const data = await extractInvoiceFromImage(base64, mimeType)
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'AI_EXTRACT',
      details: 'KI-Datenerkennung für gescannte Rechnung ausgeführt',
    })
    return NextResponse.json({ ok: true, data })
  } catch (e) {
    return jsonError(e)
  }
}
