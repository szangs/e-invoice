'use client'

// Globaler Feedback-Button (§26, Stefan 2026-08-25) — die Systemeinstellung
// "Nutzer-Feedback global aktiv" existierte schon lange (FEEDBACK_ENABLED),
// aber ohne zugehörige UI ("UI folgt in Runde 2"). Nach dem Muster von
// InterfaceRequestForm.tsx: kleines Aufklapp-Formular, geht per Mail an den
// festen Support-Kontakt, kein eigener Datensatz nötig.
import { usePathname } from 'next/navigation'
import { useState } from 'react'

export function FeedbackButton({ enabled }: { enabled: boolean }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  if (!enabled) return null

  async function send() {
    if (!message.trim()) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/support/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), page: pathname }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Senden fehlgeschlagen.')
        return
      }
      setDone(true)
      setMessage('')
    } catch {
      setError('Senden fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  function close() {
    setOpen(false)
    setDone(false)
    setError('')
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 rounded-full bg-[var(--accent)] px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition hover:opacity-90 print:hidden"
        title="Feedback, Fehler oder Wünsche direkt melden"
      >
        💬 Feedback
      </button>
    )
  }

  return (
    <div className="dp-card fixed bottom-5 right-5 z-30 w-72 space-y-2 shadow-xl print:hidden">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Feedback</p>
        <button type="button" className="text-xs text-gray-400 hover:text-gray-600" onClick={close}>✕</button>
      </div>
      {done ? (
        <p className="text-sm text-[var(--accent)]">Danke, Ihre Nachricht wurde gesendet.</p>
      ) : (
        <>
          <textarea
            className="dp-input"
            rows={4}
            placeholder="Fehler, Wunsch oder sonstiges Feedback …"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" onClick={send} disabled={busy || !message.trim()}>
              {busy ? 'Sende …' : 'Senden'}
            </button>
            <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={close}>Abbrechen</button>
          </div>
          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        </>
      )}
    </div>
  )
}
