// Einzelner Rechnungs-Anhang: herunterladen/anzeigen oder löschen
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { requireInvoiceContentAccess } from '@/lib/basketRights'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { deleteInvoiceFile, readInvoiceFile } from '@/lib/storage'

async function loadAttachment(tenantId: string, invoiceId: string, attachmentId: string) {
  const attachment = await prisma.invoiceAttachment.findFirst({
    where: { id: attachmentId, invoiceId, tenantId },
    include: { invoice: { select: { basketId: true } } },
  })
  if (!attachment) throw new ApiError(404, 'Anhang nicht gefunden.')
  return attachment
}

export async function GET(_req: NextRequest, { params }: { params: { id: string; attachmentId: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const attachment = await loadAttachment(tenantId, params.id, params.attachmentId)
    await requireInvoiceContentAccess(ctx, attachment.invoice.basketId)
    const buffer = await readInvoiceFile(tenantId, attachment.fileName)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': attachment.mimeType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(attachment.originalName)}"`,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; attachmentId: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const attachment = await loadAttachment(tenantId, params.id, params.attachmentId)
    await requireInvoiceContentAccess(ctx, attachment.invoice.basketId)
    await prisma.invoiceAttachment.delete({ where: { id: attachment.id } })
    await deleteInvoiceFile(tenantId, attachment.fileName)
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'INVOICE_ATTACHMENT_DELETE',
      details: `Anhang "${attachment.originalName}" von Rechnung ${params.id} gelöscht`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
