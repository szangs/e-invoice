// Zusätzliche Dokumente zu einer Rechnung (Stefan 2026-07-08): unabhängig
// vom Haupt-Beleg jederzeit weitere Dateien anhängen (Lieferschein, Vertrag,
// Mail-Verlauf, Bestellung …) — auch bei GoBD-gesperrten E-Rechnungen, da
// Anhänge reine Zusatzinformation sind, keine Rechnungsdaten. v1 OHNE
// Zero-Knowledge-Verschlüsselung — bei aktiver Beleg-Verschlüsselung des
// Mandanten ist der Upload daher gesperrt (kein unverschlüsseltes Material
// neben verschlüsselten Belegen).
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { requireInvoiceContentAccess } from '@/lib/basketRights'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { ALLOWED_MIME, MAX_FILE_BYTES, saveInvoiceFile } from '@/lib/storage'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const invoice = await prisma.invoice.findFirst({ where: { id: params.id, tenantId } })
    if (!invoice) throw new ApiError(404, 'Rechnung nicht gefunden.')
    await requireInvoiceContentAccess(ctx, invoice.basketId)
    const attachments = await prisma.invoiceAttachment.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { email: true, firstName: true, lastName: true } } },
    })
    return NextResponse.json({
      attachments: attachments.map((a) => ({
        id: a.id,
        originalName: a.originalName,
        mimeType: a.mimeType,
        size: a.size,
        createdAt: a.createdAt,
        uploadedByName: a.uploadedBy
          ? [a.uploadedBy.firstName, a.uploadedBy.lastName].filter(Boolean).join(' ') || a.uploadedBy.email
          : null,
      })),
    })
  } catch (e) {
    return jsonError(e)
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const invoice = await prisma.invoice.findFirst({ where: { id: params.id, tenantId } })
    if (!invoice) throw new ApiError(404, 'Rechnung nicht gefunden.')
    await requireInvoiceContentAccess(ctx, invoice.basketId)
    if (invoice.deletedAt) throw new ApiError(400, 'Rechnung ist gelöscht.')

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { encryptionEnabled: true } })
    if (tenant?.encryptionEnabled) {
      throw new ApiError(403, 'Anhänge sind bei aktiver Beleg-Verschlüsselung noch nicht verfügbar (Zero-Knowledge).')
    }

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, 'Keine Datei erhalten.')
    if (!ALLOWED_MIME.includes(file.type)) throw new ApiError(400, 'Dateityp nicht erlaubt (PDF, PNG, JPG, WebP, XML).')
    if (file.size > MAX_FILE_BYTES) throw new ApiError(400, 'Datei zu groß (max. 10 MB).')

    const buffer = Buffer.from(await file.arrayBuffer())
    const fileName = await saveInvoiceFile(tenantId, file.name, buffer)

    const attachment = await prisma.invoiceAttachment.create({
      data: {
        invoiceId: invoice.id,
        tenantId,
        fileName,
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        uploadedById: ctx.userId,
      },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'INVOICE_ATTACHMENT_ADD',
      details: `Anhang "${file.name}" zu Rechnung ${invoice.id} hinzugefügt`,
    })
    return NextResponse.json({
      attachment: {
        id: attachment.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        createdAt: attachment.createdAt,
        uploadedByName: ctx.email,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}
