// Gerichtete Nachricht an einen Mitarbeiter (Stefan 2026-07-08): anders als
// das freie Notizfeld (Invoice.notes, z. B. Kontierung) eine ADRESSIERTE
// Nachricht an einen bestimmten Kollegen — wichtig für dessen nächsten
// Bearbeitungsschritt. Kleiner Verlauf statt Überschreiben.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { requireInvoiceContentAccess } from '@/lib/basketRights'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

const schema = z.object({
  text: z.string().min(1, 'Text fehlt').max(2000),
  toUserId: z.string().optional(),
})

function displayName(u: { email: string; firstName: string | null; lastName: string | null } | null): string | null {
  if (!u) return null
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const invoice = await prisma.invoice.findFirst({ where: { id: params.id, tenantId } })
    if (!invoice) throw new ApiError(404, 'Rechnung nicht gefunden.')
    await requireInvoiceContentAccess(ctx, invoice.basketId)
    // Öffnen der Rechnung durch den adressierten Mitarbeiter markiert dessen
    // offene Nachrichten hier automatisch als gelesen.
    await prisma.invoiceNote.updateMany({
      where: { invoiceId: invoice.id, toUserId: ctx.userId, readAt: null },
      data: { readAt: new Date() },
    })
    const notes = await prisma.invoiceNote.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { email: true, firstName: true, lastName: true } },
        toUser: { select: { email: true, firstName: true, lastName: true } },
      },
    })
    return NextResponse.json({
      notes: notes.map((n) => ({
        id: n.id,
        text: n.text,
        createdAt: n.createdAt,
        readAt: n.readAt,
        authorName: displayName(n.author) ?? '—',
        toUserId: n.toUserId,
        toUserName: displayName(n.toUser),
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
    const { text, toUserId } = schema.parse(await req.json())

    if (toUserId) {
      const recipient = await prisma.user.findFirst({ where: { id: toUserId, tenantId, active: true } })
      if (!recipient) throw new ApiError(400, 'Empfänger nicht gefunden.')
    }

    const note = await prisma.invoiceNote.create({
      data: {
        invoiceId: invoice.id,
        tenantId,
        authorId: ctx.userId,
        toUserId: toUserId || null,
        text,
      },
      include: {
        author: { select: { email: true, firstName: true, lastName: true } },
        toUser: { select: { email: true, firstName: true, lastName: true } },
      },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'INVOICE_NOTE_ADD',
      details: `Nachricht zu Rechnung ${invoice.id} hinzugefügt${note.toUser ? ` (an ${displayName(note.toUser)})` : ''}`,
    })
    return NextResponse.json({
      note: {
        id: note.id,
        text: note.text,
        createdAt: note.createdAt,
        readAt: note.readAt,
        authorName: displayName(note.author) ?? '—',
        toUserId: note.toUserId,
        toUserName: displayName(note.toUser),
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}
