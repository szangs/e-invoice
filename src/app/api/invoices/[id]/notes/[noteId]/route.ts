// Nachricht als erledigt markieren/zurücksetzen (Stefan 2026-08-26) —
// eigenständig vom Lesestatus (readAt): eine Nachricht kann gelesen, aber
// noch nicht abgearbeitet sein. Nur wer den Inhalt auch sehen darf (Autor,
// Adressat, "an alle" oder Admin/Betreiber — dieselbe Regel wie beim
// Maskieren in GET .../notes) darf umschalten; wer den Inhalt gar nicht
// lesen kann, soll ihn auch nicht als erledigt abhaken können.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { alwaysFullAccess, requireInvoiceContentAccess } from '@/lib/basketRights'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

const schema = z.object({ done: z.boolean() })

export async function PATCH(req: NextRequest, { params }: { params: { id: string; noteId: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const invoice = await prisma.invoice.findFirst({ where: { id: params.id, tenantId } })
    if (!invoice) throw new ApiError(404, 'Rechnung nicht gefunden.')
    await requireInvoiceContentAccess(ctx, invoice.basketId)
    const note = await prisma.invoiceNote.findFirst({ where: { id: params.noteId, invoiceId: invoice.id, tenantId } })
    if (!note) throw new ApiError(404, 'Nachricht nicht gefunden.')
    const visible = note.authorId === ctx.userId || note.toUserId === ctx.userId || note.toUserId === null || alwaysFullAccess(ctx.role)
    if (!visible) throw new ApiError(403, 'Diese Nachricht ist nicht für Sie bestimmt.')

    const { done } = schema.parse(await req.json())
    const updated = await prisma.invoiceNote.update({
      where: { id: note.id },
      data: done ? { doneAt: new Date(), doneBy: ctx.email } : { doneAt: null, doneBy: null },
    })
    return NextResponse.json({ doneAt: updated.doneAt, doneBy: updated.doneBy })
  } catch (e) {
    return jsonError(e)
  }
}
