// "Zur Prüfung weitergeben" (Stefan 2026-08-27) — nicht "in einen anderen
// Korb verschieben" (das ändert den Workflow-Schritt dauerhaft), sondern
// eine Rechnung bleibt in ihrem Korb liegen und wird nur PERSÖNLICH an
// einen bestimmten Kollegen übergeben: die mitreisende Nachricht ist immer
// exklusiv für den Empfänger sichtbar (dieselbe Maskierung wie bei jeder
// adressierten Nachricht, siehe api/invoices/[id]/notes/route.ts). Solange
// die Übergabe aktiv ist, ist die Rechnung für JEDEN AUSSER dem Empfänger
// schreibgeschützt — der Empfänger "bearbeitet" sie jetzt. Der Empfänger
// beendet die Übergabe nicht durch Freigeben, sondern durch "Zurückgeben"
// (setzt InvoiceNote.doneAt wie ein normales Erledigt-Häkchen, siehe
// api/invoices/[id]/notes/[noteId]/route.ts) — danach ist die Rechnung
// wieder für alle mit Korb-Zugriff normal bearbeitbar.
import { prisma } from '@/lib/db'
import { ApiError } from '@/lib/context'

export type ActiveHandoff = {
  noteId: string
  toUserId: string
  toUserName: string
  authorId: string | null
  authorName: string
  subject: string | null
  text: string
  createdAt: Date
}

function displayName(u: { email: string; firstName: string | null; lastName: string | null } | null): string {
  if (!u) return '—'
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email
}

/** Der aktuell aktive Handoff dieser Rechnung, falls vorhanden — höchstens einer gleichzeitig (siehe notes/route.ts POST). */
export async function getActiveHandoff(invoiceId: string): Promise<ActiveHandoff | null> {
  const note = await prisma.invoiceNote.findFirst({
    where: { invoiceId, isHandoff: true, doneAt: null },
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: { email: true, firstName: true, lastName: true } },
      toUser: { select: { email: true, firstName: true, lastName: true } },
    },
  })
  if (!note || !note.toUserId) return null
  return {
    noteId: note.id,
    toUserId: note.toUserId,
    toUserName: displayName(note.toUser),
    authorId: note.authorId,
    authorName: displayName(note.author),
    subject: note.subject,
    text: note.text,
    createdAt: note.createdAt,
  }
}

/**
 * Defense-in-depth-Sperre für Schreibzugriffe (PATCH/DELETE/Verschieben/
 * Anhänge, siehe Aufrufer) — wirft ApiError(423), wenn die Rechnung gerade
 * an jemand ANDEREN als `userId` übergeben ist. Wer die Rechnung selbst
 * bekommen hat, darf ganz normal weiterarbeiten (kein Aufruf nötig).
 */
export async function assertNotHandedOffToSomeoneElse(invoiceId: string, userId: string): Promise<void> {
  const handoff = await getActiveHandoff(invoiceId)
  if (handoff && handoff.toUserId !== userId) {
    throw new ApiError(423, `Diese Rechnung wurde zur Prüfung an ${handoff.toUserName} übergeben — nur diese Person kann sie gerade bearbeiten.`)
  }
}
