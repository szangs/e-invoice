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
  invoiceId, vendor, invoiceNumber, missing, suggestedEmail, locked, reportText,
}: {
  invoiceId: string
  vendor: string
  invoiceNumber: string | null
  missing: string[] | null
  suggestedEmail: string | null
  locked: boolean
  /** Formatierter Prüfbericht als Text (Stefan 2026-08-26) — optional per Checkbox einfügbar, siehe InvoiceEditForm.tsx. */
  reportText: string
}) {
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState(suggestedEmail ?? '')
  const defaultMessage = buildDefaultMessage(vendor, invoiceNumber, missing)
  const [message, setMessage] = useState(defaultMessage)
  const [includeReport, setIncludeReport] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Prüfbericht anhängen/entfernen (Stefan 2026-08-26): rein additiv auf den
  // Standardtext, damit eigene Änderungen am restlichen Text beim Umschalten
  // nicht verloren gehen.
  function toggleReport(next: boolean) {
    setIncludeReport(next)
    setMessage((m) => (next ? `${m}\n\n${reportText}` : m.replace(`\n\n${reportText}`, '')))
  }

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

  // Als Fenster statt Inline-Aufklappen (Stefan 2026-08-26): der Auslöse-
  // Knopf steht jetzt kompakt oben in der Status-Leiste neben "Prüfbericht"
  // — ein dort inline aufklappendes Formular (Adresse+Textfeld) würde die
  // Leiste sprengen, ein Fenster bleibt unabhängig von der Größe kompakt.
  return (
    <>
      <button type="button" className="btn-secondary !px-2 !py-1 text-[11px]" onClick={() => setOpen(true)}
        title="Eine E-Mail an den Rechnungssteller vorbereiten, mit der Bitte um Korrektur — Sie sehen den Text vorher und lösen den Versand selbst aus">
        ✉️ Korrektur anfordern
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-lg font-semibold text-gray-800">Korrektur anfordern</h2>
            {done ? (
              <>
                <p className="mt-2 text-sm text-[var(--accent)]">{done}</p>
                <div className="mt-4 flex justify-end">
                  <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Schließen</button>
                </div>
              </>
            ) : (
              <div className="mt-3 space-y-2">
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
                  <textarea className="dp-input mt-1" rows={10} value={message} onChange={(e) => setMessage(e.target.value)} />
                </div>
                {/* Prüfbericht optional anhängen (Stefan 2026-08-26) — bewusst
                    NICHT vorausgewählt, da der Bericht auch interne, für den
                    Lieferanten irrelevante Punkte enthält (Dubletten, Spam-
                    Klassifikation, KI-Status) — der Text bleibt vor dem
                    Absenden immer editierbar/kürzbar. */}
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={includeReport} onChange={(e) => toggleReport(e.target.checked)} />
                  Prüfbericht einfügen
                </label>
                <div className="flex items-center gap-2 pt-1">
                  <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" onClick={send}
                    disabled={busy || !to.trim() || !message.trim()}>
                    {busy ? 'Sende …' : 'Absenden'}
                  </button>
                  <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => setOpen(false)}>Abbrechen</button>
                </div>
                {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
