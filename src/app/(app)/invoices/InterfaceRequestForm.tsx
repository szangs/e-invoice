'use client'

// "Vermissen Sie hier eine Schnittstelle?" (Stefan 2026-07-08) — kleiner
// Aufklapp-Button neben der Übergabe an die Fibu. Öffnet ein Mini-Formular,
// das eine Anfrage direkt per E-Mail an Stefan schickt.
import { useState } from 'react'

export function InterfaceRequestForm() {
  const [open, setOpen] = useState(false)
  const [software, setSoftware] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    if (!software.trim()) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/support/interface-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ software: software.trim(), message: message.trim() || undefined }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Senden fehlgeschlagen.')
        return
      }
      setDone(true)
      setSoftware('')
      setMessage('')
    } catch {
      setError('Senden fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="text-xs text-gray-400 underline hover:text-gray-600"
        onClick={() => setOpen(true)}
        title="Aktuell wird nur DATEV unterstützt — hier eine andere Buchhaltungs-Schnittstelle vorschlagen"
      >
        Vermissen Sie hier eine Schnittstelle?
      </button>
    )
  }

  if (done) {
    return <p className="text-xs text-[var(--accent)]">Danke, Ihre Anfrage wurde gesendet.</p>
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        className="dp-input !w-40 !py-1 text-xs"
        placeholder="z. B. Lexware, sevDesk …"
        value={software}
        onChange={(e) => setSoftware(e.target.value)}
      />
      <input
        className="dp-input !w-56 !py-1 text-xs"
        placeholder="Kurze Nachricht (optional)"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <button type="button" className="btn-secondary !px-2 !py-1 text-xs" onClick={send} disabled={busy || !software.trim()}>
        {busy ? 'Sende …' : 'Anfragen'}
      </button>
      <button type="button" className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>
        abbrechen
      </button>
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
    </div>
  )
}
