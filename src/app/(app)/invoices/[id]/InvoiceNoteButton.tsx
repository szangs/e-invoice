'use client'

// Eigenständige Nachricht ohne Korb-Verschiebung (Stefan 2026-08-26,
// Review-Fund: bisher gab es nur die an "In anderen Korb verschieben"
// gekoppelte Nachricht in BasketMoveButton.tsx — wer einfach nur eine
// Notiz an einen Kollegen hinterlassen wollte, ohne die Rechnung zu
// verschieben, hatte keine Möglichkeit dazu).
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function InvoiceNoteButton({
  invoiceId,
  colleagues,
}: {
  invoiceId: string
  colleagues: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [toUserId, setToUserId] = useState('')

  async function send() {
    if (!message.trim()) {
      setError('Bitte einen Text eingeben.')
      return
    }
    setBusy(true)
    setError('')
    const res = await fetch(`/api/invoices/${invoiceId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: subject.trim() || undefined, text: message.trim(), toUserId: toUserId || undefined }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Nachricht konnte nicht gesendet werden.')
      return
    }
    setOpen(false)
    setSubject('')
    setMessage('')
    setToUserId('')
    router.refresh()
  }

  return (
    <>
      <button type="button" className="btn-secondary !px-2 !py-1 text-[11px]" onClick={() => setOpen(true)}
        title="Nachricht zu dieser Rechnung hinterlassen, ohne sie zu verschieben">
        💬 Nachricht
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-lg font-semibold text-gray-800">Nachricht zu dieser Rechnung</h2>
            <div className="mt-3 space-y-2">
              <div>
                <label className="dp-label">An</label>
                <select className="dp-input mt-1 w-full" value={toUserId} onChange={(e) => setToUserId(e.target.value)}
                  title="Optional — leer lassen für eine allgemeine Notiz an alle, die diese Rechnung bearbeiten">
                  <option value="">(alle / unadressiert)</option>
                  {colleagues.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="dp-label">Betreff</label>
                <input className="dp-input mt-1 w-full" value={subject} onChange={(e) => setSubject(e.target.value)}
                  maxLength={200} placeholder="z. B. Kostenstelle fehlt" />
              </div>
              <div>
                <label className="dp-label">Text</label>
                <textarea className="dp-input mt-1 w-full" rows={4} value={message} onChange={(e) => setMessage(e.target.value)}
                  maxLength={4000} placeholder="z. B. Bitte Kostenstelle prüfen und ergänzen." />
              </div>
            </div>
            {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Abbrechen</button>
              <button type="button" className="btn-primary" onClick={send} disabled={busy}>
                {busy ? 'Sende …' : 'Senden'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
