// Gerichtete Nachricht an einen Mitarbeiter (Stefan 2026-07-08): anders als
// das freie Notizfeld (Invoice.notes, z. B. Kontierung) eine ADRESSIERTE
// Nachricht an einen bestimmten Kollegen — wichtig für dessen nächsten
// Bearbeitungsschritt. Kleiner Verlauf statt Überschreiben.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { alwaysFullAccess, requireInvoiceContentAccess } from '@/lib/basketRights'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

const schema = z.object({
  subject: z.string().max(200).optional(),
  text: z.string().min(1, 'Text fehlt').max(4000),
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
    // Vor dem Als-gelesen-Markieren merken, welche adressierten Nachrichten
    // gerade JETZT ungelesen waren (Stefan 2026-08-26) — Grundlage dafür, ob
    // die Detailseite die Nachricht automatisch aufklappen soll
    // (InvoiceNotes.tsx). Nach dem Update wäre das nicht mehr
    // unterscheidbar, da readAt dann schon gesetzt ist.
    const justUnread = await prisma.invoiceNote.findMany({
      where: { invoiceId: invoice.id, toUserId: ctx.userId, readAt: null },
      select: { id: true },
    })
    const justUnreadIds = new Set(justUnread.map((n) => n.id))
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
      notes: notes.map((n) => {
        // Inhalt nur für Autor, Adressat, "an alle"-Nachrichten und Admins/
        // Betreiber sichtbar (Stefan 2026-08-26, "die anderen sehen nur einen
        // stilisierten text") — jeder mit Korb-Zugriff sieht, DASS es eine
        // gerichtete Nachricht gibt (von wem, an wen, wann, erledigt-Status),
        // aber nicht ihren Inhalt, wenn er nicht der Adressat ist.
        const visible = n.authorId === ctx.userId || n.toUserId === ctx.userId || n.toUserId === null || alwaysFullAccess(ctx.role)
        return {
          id: n.id,
          subject: visible ? n.subject : null,
          text: visible ? n.text : 'Nur für den Adressaten sichtbar.',
          masked: !visible,
          createdAt: n.createdAt,
          readAt: n.readAt,
          doneAt: n.doneAt,
          doneBy: n.doneBy,
          authorName: displayName(n.author) ?? '—',
          toUserId: n.toUserId,
          toUserName: displayName(n.toUser),
          // Stefan 2026-08-26: war bei DIESEM Aufruf gerade eben ungelesen und
          // an mich adressiert — siehe InvoiceNotes.tsx.
          wasUnreadForMe: justUnreadIds.has(n.id),
        }
      }),
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
    const { subject, text, toUserId } = schema.parse(await req.json())

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
        subject: subject || null,
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
        subject: note.subject,
        text: note.text,
        createdAt: note.createdAt,
        readAt: note.readAt,
        doneAt: note.doneAt,
        doneBy: note.doneBy,
        authorName: displayName(note.author) ?? '—',
        toUserId: note.toUserId,
        toUserName: displayName(note.toUser),
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}
