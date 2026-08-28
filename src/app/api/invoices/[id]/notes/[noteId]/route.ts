// Nachricht als erledigt markieren/zurücksetzen (Stefan 2026-08-26) —
// eigenständig vom Lesestatus (readAt): eine Nachricht kann gelesen, aber
// noch nicht abgearbeitet sein. Nur wer den Inhalt auch sehen darf (Autor,
// Adressat, "an alle" oder Admin/Betreiber — dieselbe Regel wie beim
// Maskieren in GET .../notes) darf umschalten; wer den Inhalt gar nicht
// lesen kann, soll ihn auch nicht als erledigt abhaken können.
// Bei isHandoff=true (Stefan 2026-08-27, "Zur Prüfung weitergeben") bedeutet
// dieser Haken "zurückgeben" statt "erledigt" — dafür gilt eine ENGERE
// Regel: nur Empfänger ODER Absender dürfen das, nicht einmal Admin/
// Betreiber. Empfänger = "Zurückgeben" (fertig bearbeitet, war der
// ursprüngliche Wunsch: "nicht freigeben, sondern der Empfänger
// entscheidet"). Absender = "Zurückholen" (Stefan 2026-08-27,
// Fehlerbericht "es fehlt eine Option, sie zurückzuholen" — z. B. an den
// falschen Kollegen übergeben, oder es eilt jetzt doch selbst). Welcher der
// beiden es war, ergibt sich aus doneBy (== ctx.email) im Vergleich zu
// Empfänger/Absender — kein eigenes Feld nötig.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { alwaysFullAccess, requireInvoiceAccess } from '@/lib/basketRights'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

const schema = z.object({ done: z.boolean() })

export async function PATCH(req: NextRequest, { params }: { params: { id: string; noteId: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const invoice = await prisma.invoice.findFirst({ where: { id: params.id, tenantId } })
    if (!invoice) throw new ApiError(404, 'Rechnung nicht gefunden.')
    await requireInvoiceAccess(ctx, invoice)
    const note = await prisma.invoiceNote.findFirst({ where: { id: params.noteId, invoiceId: invoice.id, tenantId } })
    if (!note) throw new ApiError(404, 'Nachricht nicht gefunden.')
    if (note.isHandoff) {
      if (note.toUserId !== ctx.userId && note.authorId !== ctx.userId) {
        throw new ApiError(403, 'Nur Absender oder Empfänger können diese Übergabe beenden.')
      }
    } else {
      const visible = note.authorId === ctx.userId || note.toUserId === ctx.userId || note.toUserId === null || alwaysFullAccess(ctx.role)
      if (!visible) throw new ApiError(403, 'Diese Nachricht ist nicht für Sie bestimmt.')
    }

    const { done } = schema.parse(await req.json())
    const updated = await prisma.invoiceNote.update({
      where: { id: note.id },
      data: done ? { doneAt: new Date(), doneBy: ctx.email } : { doneAt: null, doneBy: null },
    })
    if (note.isHandoff && done) {
      const isRecall = note.authorId === ctx.userId
      await audit({
        tenantId,
        actorId: ctx.userId,
        actorName: ctx.email,
        action: isRecall ? 'INVOICE_HANDOFF_RECALL' : 'INVOICE_HANDOFF_RETURN',
        details: `Rechnung ${invoice.id} ${isRecall ? 'zurückgeholt (durch Absender)' : 'zurückgegeben'}`,
      })
    }
    return NextResponse.json({ doneAt: updated.doneAt, doneBy: updated.doneBy })
  } catch (e) {
    return jsonError(e)
  }
}
