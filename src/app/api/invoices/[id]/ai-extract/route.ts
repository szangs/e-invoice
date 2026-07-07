// KI-gestützte Datenerkennung NACHTRÄGLICH auf einem bereits gespeicherten
// Beleg (z. B. ein früher gescanntes Foto ohne KI-Erfassung). Nutzt denselben
// KI-Anbieter/dieselben Regeln wie beim Scan selbst (/api/invoices/ai-extract):
// nur wenn der Mandant KI erlaubt UND dieser konkrete Beleg unverschlüsselt
// ist (Zero-Knowledge) UND es sich um ein Bild handelt (kein PDF — dafür gibt
// es noch keine Seiten-Rasterung).
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { extractInvoiceFromImage } from '@/lib/aiExtract'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
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
    if (!invoice.mimeType || !IMAGE_MIMES.includes(invoice.mimeType)) {
      throw new ApiError(400, 'KI-Erkennung funktioniert bisher nur bei Foto-Belegen (PNG/JPG/WebP), nicht bei PDF.')
    }

    const buffer = await readInvoiceFile(tenantId, invoice.fileName)
    const data = await extractInvoiceFromImage(buffer.toString('base64'), invoice.mimeType)
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
