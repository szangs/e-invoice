'use client'

// "Zur Prüfung weitergeben" (Stefan 2026-08-27) — anders als "In anderen
// Korb verschieben" bleibt die Rechnung in ihrem Korb liegen und wird nur
// PERSÖNLICH an einen Kollegen übergeben: die Nachricht ist exklusiv für den
// Empfänger sichtbar, die Rechnung wird für jeden außer ihm schreibgeschützt,
// bis er sie per "Zurückgeben" wieder freigibt (siehe InvoiceEditForm.tsx
// Banner + InvoiceNotes.tsx, lib/invoiceHandoff.ts).
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function InvoiceHandoffButton({
  invoiceId,
  colleagues,
  disabled,
}: {
  invoiceId: string
  colleagues: { id: string; name: string }[]
  disabled?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [toUserId, setToUserId] = useState('')

  async function send() {
    if (!toUserId) {
      setError('Bitte einen Empfänger auswählen.')
      return
    }
    setBusy(true)
    setError('')
    const res = await fetch(`/api/invoices/${invoiceId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: subject.trim() || undefined, text: message.trim() || '(ohne Nachricht)', toUserId, isHandoff: true }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(data.error ?? 'Weitergeben fehlgeschlagen.')
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
        disabled={disabled || colleagues.length === 0}
        title="Diese Rechnung an einen Kollegen zur Prüfung weitergeben — bleibt im aktuellen Korb, wird aber bis zur Rückgabe für alle außer dem Empfänger schreibgeschützt">
        📤 Zur Prüfung weitergeben
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-lg font-semibold text-gray-800">Zur Prüfung weitergeben</h2>
            <p className="mt-1 text-xs text-gray-500">
              Die Rechnung bleibt in ihrem aktuellen Korb, wird aber bis zur Rückgabe für alle außer dem
              Empfänger schreibgeschützt (kein Bearbeiten, Verschieben, Löschen). Die Nachricht ist nur
              für den Empfänger sichtbar.
            </p>
            <div className="mt-3 space-y-2">
              <div>
                <label className="dp-label">An (Pflicht)</label>
                <select className="dp-input mt-1 w-full" value={toUserId} onChange={(e) => setToUserId(e.target.value)} required>
                  <option value="">— bitte wählen —</option>
                  {colleagues.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="dp-label">Betreff</label>
                <input className="dp-input mt-1 w-full" value={subject} onChange={(e) => setSubject(e.target.value)}
                  maxLength={200} placeholder="z. B. Bitte sachlich prüfen" />
              </div>
              <div>
                <label className="dp-label">Nachricht (optional)</label>
                <textarea className="dp-input mt-1 w-full" rows={4} value={message} onChange={(e) => setMessage(e.target.value)}
                  maxLength={4000} placeholder="z. B. Bitte kurz gegenprüfen, wirkt ungewöhnlich hoch." />
              </div>
            </div>
            {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Abbrechen</button>
              <button type="button" className="btn-primary" onClick={send} disabled={busy || !toUserId}>
                {busy ? 'Übergebe …' : 'Weitergeben'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
