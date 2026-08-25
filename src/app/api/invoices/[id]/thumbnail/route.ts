// Mini-Vorschau eines Belegs für die Rechnungsliste (Stefan 2026-08-25) —
// kleine Miniatur (PDF erste Seite bei niedrigem Maßstab, oder verkleinertes
// Foto/Scan), nur zur groben Kurzeinschätzung ohne den Beleg öffnen zu
// müssen. Kein Ersatz für die volle Vorschau auf der Detailseite
// (BelegPreview.tsx). Bei verschlüsselten Belegen (Zero-Knowledge) oder
// nicht darstellbaren Dateitypen (reine XML) liefert die Route bewusst 204
// statt eines Fehlers — der Aufrufer zeigt dann einfach nichts an.
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { requireInvoiceContentAccess } from '@/lib/basketRights'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { rasterizeFirstPage } from '@/lib/pdfRaster'
import { readInvoiceFile, readThumbnailCache, writeThumbnailCache } from '@/lib/storage'
import { resizeImageToThumbnail } from '@/lib/thumbnail'

const THUMB_WIDTH = 140
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp']

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const invoice = await prisma.invoice.findFirst({ where: { id: params.id, tenantId } })
    if (!invoice) throw new ApiError(404, 'Rechnung nicht gefunden.')
    await requireInvoiceContentAccess(ctx, invoice.basketId)

    if (invoice.encrypted || !invoice.fileName) {
      return new NextResponse(null, { status: 204 })
    }

    const cached = await readThumbnailCache(tenantId, invoice.fileName)
    if (cached) {
      return new NextResponse(new Uint8Array(cached), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' },
      })
    }

    const mime = invoice.mimeType
    let png: Buffer | null = null
    if (mime === 'application/pdf') {
      const buffer = await readInvoiceFile(tenantId, invoice.fileName)
      png = await rasterizeFirstPage(buffer, 0.35)
    } else if (mime && IMAGE_MIMES.includes(mime)) {
      const buffer = await readInvoiceFile(tenantId, invoice.fileName)
      png = await resizeImageToThumbnail(buffer, THUMB_WIDTH)
    }
    if (!png) return new NextResponse(null, { status: 204 })

    await writeThumbnailCache(tenantId, invoice.fileName, png)
    return new NextResponse(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400' },
    })
  } catch (e) {
    return jsonError(e)
  }
}
