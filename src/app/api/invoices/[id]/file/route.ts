// Beleg-Datei ausliefern — nur für den eigenen Mandanten (§22)
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { requireInvoiceContentAccess } from '@/lib/basketRights'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { readInvoiceFile } from '@/lib/storage'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const invoice = await prisma.invoice.findFirst({ where: { id: params.id, tenantId } })
    if (!invoice) throw new ApiError(404, 'Rechnung nicht gefunden')
    await requireInvoiceContentAccess(ctx, invoice.basketId)
    if (!invoice.fileName) throw new ApiError(404, 'Kein Beleg vorhanden')
    const buffer = await readInvoiceFile(tenantId, invoice.fileName)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': invoice.mimeType ?? 'application/octet-stream',
        'Content-Disposition': `inline; filename="${encodeURIComponent(invoice.originalName ?? 'beleg')}"`,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}
