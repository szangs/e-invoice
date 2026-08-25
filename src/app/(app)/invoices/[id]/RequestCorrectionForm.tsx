'use client'

// "Korrektur anfordern" (Stefan 2026-08-25): Text mit den erkannten
// Pflichtangaben-Fehlern vorausfüllen, aber IMMER von einem Menschen prüfen
// und aktiv absenden lassen — bewusst kein automatischer Versand (siehe
// api/invoices/[id]/request-correction/route.ts).
import { useState } from 'react'

function buildDefaultMessage(vendor: string, invoiceNumber: string | null, missing: string[] | null): string {
  const ref = invoiceNumber ? `Rechnung ${invoiceNumber}` : 'Ihre Rechnung'
  const lines = [
    `Sehr geehrte Damen und Herren,`,
    ``,
    `bei der Prüfung von ${ref} ${invoiceNumber ? 'ist uns' : 'sind uns'} folgende(r) Punkt(e) aufgefallen:`,
    ``,
  ]
  if (missing && missing.length > 0) {
    lines.push(...missing.map((m) => `- ${m} fehlt bzw. ist nicht eindeutig angegeben.`))
  } else {
    lines.push('- (bitte hier den konkreten Punkt ergänzen)')
  }
  lines.push(
    ``,
    `Wir bitten um eine korrigierte Rechnung mit den vollständigen Angaben.`,
    ``,
    `Mit freundlichen Grüßen`,
  )
  return lines.join('\n')
}

export function RequestCorrectionForm({
  invoiceId, vendor, invoiceNumber, missing, suggestedEmail, locked,
}: {
  invoiceId: string
  vendor: string
  invoiceNumber: string | null
  missing: string[] | null
  suggestedEmail: string | null
  locked: boolean
}) {
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState(suggestedEmail ?? '')
  const [message, setMessage] = useState(() => buildDefaultMessage(vendor, invoiceNumber, missing))
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (locked) return null

  async function send() {
    if (!to.trim() || !message.trim()) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/request-correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), message: message.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Senden fehlgeschlagen.')
        return
      }
      setDone(
        data.devSkipped
          ? 'Entwicklermodus aktiv — es wurde nichts wirklich verschickt (Vorschau nur lokal geprüft).'
          : `Korrektur-Anfrage an ${to.trim()} gesendet.`,
      )
    } catch {
      setError('Senden fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => setOpen(true)}
        title="Eine E-Mail an den Rechnungssteller vorbereiten, mit der Bitte um Korrektur — Sie sehen den Text vorher und lösen den Versand selbst aus">
        ✉️ Korrektur anfordern
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3 space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Korrektur anfordern</p>
      {done ? (
        <>
          <p className="text-sm text-[var(--accent)]">{done}</p>
          <button type="button" className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>Schließen</button>
        </>
      ) : (
        <>
          <div>
            <label className="dp-label">An (E-Mail des Rechnungsstellers)</label>
            <input type="email" className="dp-input mt-1" value={to} onChange={(e) => setTo(e.target.value)}
              placeholder="rechnung@lieferant.de" />
            {!suggestedEmail && (
              <p className="mt-1 text-[11px] text-gray-400">Keine Absenderadresse automatisch erkannt — bitte selbst eintragen.</p>
            )}
          </div>
          <div>
            <label className="dp-label">Nachricht</label>
            <textarea className="dp-input mt-1" rows={8} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" onClick={send}
              disabled={busy || !to.trim() || !message.trim()}>
              {busy ? 'Sende …' : 'Absenden'}
            </button>
            <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => setOpen(false)}>Abbrechen</button>
          </div>
          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        </>
      )}
    </div>
  )
}
