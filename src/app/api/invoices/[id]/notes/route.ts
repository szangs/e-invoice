// Gerichtete Nachricht an einen Mitarbeiter (Stefan 2026-07-08): anders als
// das freie Notizfeld (Invoice.notes, z. B. Kontierung) eine ADRESSIERTE
// Nachricht an einen bestimmten Kollegen — wichtig für dessen nächsten
// Bearbeitungsschritt. Kleiner Verlauf statt Überschreiben.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { alwaysFullAccess, requireInvoiceAccess } from '@/lib/basketRights'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { getActiveHandoff } from '@/lib/invoiceHandoff'

const schema = z.object({
  subject: z.string().max(200).optional(),
  text: z.string().min(1, 'Text fehlt').max(4000),
  toUserId: z.string().optional(),
  // "Zur Prüfung weitergeben" (Stefan 2026-08-27) — siehe lib/invoiceHandoff.ts.
  isHandoff: z.boolean().optional(),
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
    await requireInvoiceAccess(ctx, invoice)
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
        // Erledigt/Zurückgeben/Zurückholen-Haken (Stefan 2026-08-27, siehe
        // ausführlichen Kommentar in .../notes/[noteId]/route.ts): bei einem
        // Handoff dürfen NUR Empfänger ODER Absender umschalten (nicht
        // Admin/Betreiber), sonst dieselbe Regel wie die Sichtbarkeit — muss
        // zur PATCH-Route passen. handoffRole steuert in InvoiceNotes.tsx nur
        // die Beschriftung ("Zurückgeben" vs. "Zurückholen"), keine Rechte.
        const canToggle = n.isHandoff ? (n.toUserId === ctx.userId || n.authorId === ctx.userId) : visible
        const handoffRole: 'recipient' | 'sender' | null = !n.isHandoff
          ? null
          : n.toUserId === ctx.userId ? 'recipient' : n.authorId === ctx.userId ? 'sender' : null
        // Wer eine bereits geschlossene Übergabe beendet hat — "Zurückgeben"
        // (Empfänger) oder "Zurückholen" (Absender) — nur für die
        // Beschriftung im schon-erledigt-Zustand, per E-Mail-Abgleich
        // bestimmt, da doneBy nur die E-Mail speichert (siehe .../[noteId]).
        const closedByRole: 'recipient' | 'sender' | null =
          !n.isHandoff || !n.doneBy
            ? null
            : n.doneBy === n.toUser?.email ? 'recipient' : n.doneBy === n.author?.email ? 'sender' : null
        return {
          id: n.id,
          subject: visible ? n.subject : null,
          text: visible ? n.text : 'Nur für den Adressaten sichtbar.',
          masked: !visible,
          createdAt: n.createdAt,
          readAt: n.readAt,
          doneAt: n.doneAt,
          doneBy: n.doneBy,
          isHandoff: n.isHandoff,
          canToggle,
          handoffRole,
          closedByRole,
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
    await requireInvoiceAccess(ctx, invoice)
    const { subject, text, toUserId, isHandoff } = schema.parse(await req.json())

    if (toUserId) {
      const recipient = await prisma.user.findFirst({ where: { id: toUserId, tenantId, active: true } })
      if (!recipient) throw new ApiError(400, 'Empfänger nicht gefunden.')
    }

    // "Zur Prüfung weitergeben" (Stefan 2026-08-27, siehe lib/invoiceHandoff.ts)
    // — anders als eine normale, optional adressierte Nachricht braucht ein
    // Handoff zwingend einen Empfänger, und es darf immer nur EINER
    // gleichzeitig aktiv sein (serverseitig erzwungen — der "Weitergeben"-
    // Knopf blendet sich in der UI zwar schon aus, solange einer läuft, aber
    // ein direkter API-Aufruf darf das nicht umgehen können).
    if (isHandoff) {
      if (!toUserId) throw new ApiError(400, 'Zur Prüfung weitergeben braucht einen Empfänger.')
      const existing = await getActiveHandoff(invoice.id)
      if (existing) {
        throw new ApiError(409, `Diese Rechnung ist bereits an ${existing.toUserName} zur Prüfung übergeben — erst zurückgeben, bevor sie erneut weitergegeben werden kann.`)
      }
    }

    const note = await prisma.invoiceNote.create({
      data: {
        invoiceId: invoice.id,
        tenantId,
        authorId: ctx.userId,
        toUserId: toUserId || null,
        subject: subject || null,
        text,
        isHandoff: Boolean(isHandoff),
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
      action: isHandoff ? 'INVOICE_HANDOFF' : 'INVOICE_NOTE_ADD',
      details: isHandoff
        ? `Rechnung ${invoice.id} zur Prüfung an ${displayName(note.toUser)} übergeben`
        : `Nachricht zu Rechnung ${invoice.id} hinzugefügt${note.toUser ? ` (an ${displayName(note.toUser)})` : ''}`,
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
        isHandoff: note.isHandoff,
        authorName: displayName(note.author) ?? '—',
        toUserId: note.toUserId,
        toUserName: displayName(note.toUser),
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}
