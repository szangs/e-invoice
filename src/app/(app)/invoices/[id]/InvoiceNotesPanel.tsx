'use client'

// Gerichtete Nachricht an einen Mitarbeiter (Stefan 2026-07-08): getrennt vom
// freien Notizfeld — adressiert an eine bestimmte Person, wichtig für deren
// nächsten Bearbeitungsschritt. Siehe /api/invoices/[id]/notes.
import { useEffect, useState } from 'react'

type Note = {
  id: string
  text: string
  createdAt: string
  readAt: string | null
  authorName: string
  toUserId: string | null
  toUserName: string | null
}

export function InvoiceNotesPanel({
  invoiceId,
  colleagues,
}: {
  invoiceId: string
  colleagues: { id: string; name: string }[]
}) {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [text, setText] = useState('')
  const [toUserId, setToUserId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function load() {
    fetch(`/api/invoices/${invoiceId}/notes`)
      .then((r) => r.json())
      .then((d) => setNotes(d.notes ?? []))
      .catch(() => setError('Nachrichten konnten nicht geladen werden.'))
  }

  useEffect(load, [invoiceId])

  async function send() {
    if (!text.trim()) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), toUserId: toUserId || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Nachricht konnte nicht gesendet werden.')
        return
      }
      setText('')
      load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-[var(--line)] pt-3">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500"
        title="Adressierte Nachricht an einen Kollegen, wichtig für dessen nächsten Bearbeitungsschritt — anders als das freie Notizfeld oben">
        💬 Nachricht an Kollegen
      </h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px]">
          <label className="dp-label">An</label>
          <select className="dp-input mt-1" value={toUserId} onChange={(e) => setToUserId(e.target.value)}
            title="Optional — leer lassen für eine allgemeine Notiz an alle, die diese Rechnung bearbeiten">
            <option value="">(alle / unadressiert)</option>
            {colleagues.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[220px] flex-1">
          <label className="dp-label">Nachricht</label>
          <input className="dp-input mt-1" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="z. B. Bitte Kostenstelle prüfen, betrifft Projekt X"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send() } }} />
        </div>
        <button type="button" className="btn-secondary" onClick={send} disabled={busy || !text.trim()}
          title="Nachricht senden — erscheint sofort für alle, die diese Rechnung öffnen">
          Senden
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
      {notes === null && <p className="mt-2 text-xs text-gray-400">Lade …</p>}
      {notes && notes.length === 0 && <p className="mt-2 text-xs text-gray-400">Noch keine Nachrichten.</p>}
      {notes && notes.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-[var(--surface-muted)] px-2.5 py-1.5 text-xs">
              <p className="text-gray-800">{n.text}</p>
              <p className="mt-0.5 text-[10px] text-gray-400">
                {n.authorName}{n.toUserName ? ` → ${n.toUserName}` : ''} · {new Date(n.createdAt).toLocaleString('de-DE')}
                {n.toUserName ? (n.readAt ? ' · gelesen' : ' · ungelesen') : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
