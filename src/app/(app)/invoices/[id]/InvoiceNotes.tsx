'use client'

// Nachrichten zu einem Beleg (Stefan 2026-08-26): reisen mit dem Dokument
// mit statt an einen Korb-Wechsel gebunden zu sein (siehe BasketMoveButton.tsx
// fürs Anhängen). Zwei Teile:
// 1) Ein Auto-Popup für gerade eben neu eingetroffene, an mich adressierte
//    oder unadressierte ("an alle") Nachrichten — die "Überraschungs"-
//    Benachrichtigung beim Öffnen.
// 2) Eine IMMER sichtbare Liste ganz unten auf der Seite (Stefan 2026-08-26,
//    "bitte die Nachrichten ... ganz unten als Liste anzeigen") — damit sie
//    jederzeit nachlesbar bleiben, nicht nur einmalig als Popup.
// Inhalt (Betreff/Text) kommt vom Server bereits rechte-geprüft: Autor,
// Adressat, "an alle" und Admin/Betreiber sehen den echten Inhalt, alle
// anderen mit Korb-Zugriff nur einen stilisierten Platzhalter (siehe api/
// invoices/[id]/notes/route.ts) — "Rechte beachten".
import { useEffect, useState } from 'react'

type Note = {
  id: string
  subject: string | null
  text: string
  createdAt: string
  authorName: string
  toUserId: string | null
  toUserName: string | null
  wasUnreadForMe: boolean
  doneAt: string | null
  doneBy: string | null
  masked: boolean
  // "Zur Prüfung weitergeben" (Stefan 2026-08-27) — siehe lib/invoiceHandoff.ts.
  isHandoff: boolean
  // Vom Server berechnet (Stefan 2026-08-27): bei isHandoff Empfänger ODER
  // Absender, sonst dieselbe Sichtbarkeitsregel wie masked — vermeidet, die
  // eigene Nutzer-ID zum Vergleichen ins Frontend geben zu müssen.
  canToggle: boolean
  // Nur für die Beschriftung ("Zurückgeben" vs. "Zurückholen"), keine
  // eigene Rechteprüfung — die macht bereits canToggle/der Server.
  handoffRole: 'recipient' | 'sender' | null
  // Wer eine bereits geschlossene Übergabe beendet hat — für die
  // Beschriftung im erledigt-Zustand (kann von handoffRole abweichen, z. B.
  // sieht der Absender hier, DASS der Empfänger zurückgegeben hat).
  closedByRole: 'recipient' | 'sender' | null
}

/** "Zurückgegeben" (Empfänger) vs. "Zurückgeholt" (Absender) — siehe closedByRole. */
function closedHandoffLabel(note: Note): string {
  return note.closedByRole === 'sender' ? 'Zurückgeholt' : 'Zurückgegeben'
}

function NoteItem({ note, onToggleDone }: { note: Note; onToggleDone: (noteId: string, done: boolean) => void }) {
  const canToggle = note.canToggle
  return (
    <li className={`rounded-lg px-3 py-2 text-sm ${note.doneAt ? 'bg-gray-50 opacity-60' : note.isHandoff ? 'bg-[var(--accent-bg)]' : 'bg-[var(--surface-muted)]'}`}>
      {note.isHandoff && <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--accent)]">📤 Zur Prüfung weitergeben</p>}
      {note.masked ? (
        <p className="italic text-gray-400">🔒 Nachricht {note.toUserName ? `an ${note.toUserName}` : ''} — nur für den Adressaten sichtbar</p>
      ) : (
        <>
          {note.subject && <p className="font-semibold text-gray-800">{note.subject}</p>}
          <p className="whitespace-pre-wrap text-gray-800">{note.text}</p>
        </>
      )}
      <p className="mt-1 text-[10px] text-gray-400">
        {note.authorName}{note.toUserName ? ` → ${note.toUserName}` : ' → alle'} · {new Date(note.createdAt).toLocaleString('de-DE')}
      </p>
      {!canToggle ? (
        note.doneAt && (
          <p className="mt-1.5 text-xs text-[var(--accent)]">
            ↩ {closedHandoffLabel(note)} ({note.doneBy ?? '—'}, {new Date(note.doneAt).toLocaleString('de-DE')})
          </p>
        )
      ) : note.masked ? (
        note.doneAt && <p className="mt-1.5 text-xs text-[var(--accent)]">✓ Erledigt</p>
      ) : (
        <label className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            className="accent-[var(--accent)]"
            checked={Boolean(note.doneAt)}
            onChange={(e) => onToggleDone(note.id, e.target.checked)}
          />
          {note.isHandoff
            ? note.doneAt
              ? `${closedHandoffLabel(note)} (${note.doneBy ?? '—'}, ${new Date(note.doneAt).toLocaleString('de-DE')})`
              : note.handoffRole === 'sender' ? '↩ Zurückholen' : '↩ Zurückgeben'
            : note.doneAt
              ? `Erledigt (${note.doneBy ?? '—'}, ${new Date(note.doneAt).toLocaleString('de-DE')})`
              : 'Als erledigt markieren'}
        </label>
      )}
    </li>
  )
}

export function InvoiceNotes({ invoiceId }: { invoiceId: string }) {
  const [notes, setNotes] = useState<Note[] | null>(null)
  // Nur die IDs merken, nicht die Notiz-Objekte selbst (Stefan 2026-08-26) —
  // sonst zeigt das Auto-Popup beim Abhaken des Erledigt-Hakens einen
  // veralteten Stand, weil es aus einer separaten Kopie statt aus notes
  // gerendert würde.
  const [autoShowIds, setAutoShowIds] = useState<Set<string> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/invoices/${invoiceId}/notes`)
      .then((r) => r.json())
      .then((d: { notes?: Note[] }) => {
        if (cancelled) return
        const list = d.notes ?? []
        setNotes(list)
        // Automatisches Aufklappen NUR für an mich adressierte, gerade eben
        // ungelesene Nachrichten und unadressierte ("an alle") — für Letztere
        // gibt es keinen Lese-Status, sie erscheinen deshalb bei jedem Öffnen
        // erneut (bewusst wie eine Durchsage), außer bereits als erledigt markiert.
        const relevant = list.filter((n) => (n.wasUnreadForMe || n.toUserId === null) && !n.doneAt)
        if (relevant.length > 0) setAutoShowIds(new Set(relevant.map((n) => n.id)))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [invoiceId])

  async function toggleDone(noteId: string, done: boolean) {
    // Optimistisch aktualisieren (Stefan 2026-08-26) — Haken soll sofort
    // reagieren, nicht erst nach dem Server-Roundtrip; doneBy kommt erst mit
    // der echten Server-Antwort unten (Name des tatsächlichen Nutzers).
    setNotes((prev) => prev?.map((n) => (n.id === noteId ? { ...n, doneAt: done ? new Date().toISOString() : null } : n)) ?? prev)
    const res = await fetch(`/api/invoices/${invoiceId}/notes/${noteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done }),
    })
    const data = await res.json().catch(() => null)
    if (res.ok && data) {
      setNotes((prev) => prev?.map((n) => (n.id === noteId ? { ...n, doneAt: data.doneAt, doneBy: data.doneBy } : n)) ?? prev)
    }
  }

  const autoShow = autoShowIds ? (notes?.filter((n) => autoShowIds.has(n.id)) ?? null) : null

  return (
    <>
      {autoShow && autoShow.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAutoShowIds(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-lg font-semibold text-gray-800">
              💬 {autoShow.length === 1 ? 'Nachricht zu dieser Rechnung' : `${autoShow.length} Nachrichten zu dieser Rechnung`}
            </h2>
            <ul className="mt-3 space-y-2">
              {autoShow.map((n) => <NoteItem key={n.id} note={n} onToggleDone={toggleDone} />)}
            </ul>
            <div className="mt-4 flex justify-end">
              <button type="button" className="btn-primary" onClick={() => setAutoShowIds(null)}>Verstanden</button>
            </div>
          </div>
        </div>
      )}

      {/* Ganz unten auf der Seite, immer sichtbar als Liste (Stefan
          2026-08-26) — nicht mehr nur ein Hinweis-Chip zum Aufklappen. */}
      {notes && notes.length > 0 && (
        <div>
          <h3 className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-gray-500">
            💬 Nachrichten zu diesem Beleg
          </h3>
          <div className="dp-card">
            <ul className="space-y-2">
              {notes.map((n) => <NoteItem key={n.id} note={n} onToggleDone={toggleDone} />)}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
