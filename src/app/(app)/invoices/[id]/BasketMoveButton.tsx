'use client'

// Verschieben als Button + Dialog statt Dropdown (Stefan 2026-08-26): das
// winzige <select> in der Status-Leiste war leicht zu übersehen/zu treffen —
// jetzt ein eigener Knopf neben der Hauptaktion, der erst fragt, wohin.
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type BasketOption = { id: string; name: string }

export function BasketMoveButton({
  invoiceId,
  currentBasketId,
  baskets,
  pending,
  disabled,
  disabledReason,
  colleagues,
}: {
  invoiceId: string
  currentBasketId: string | null
  baskets: BasketOption[]
  pending: { targetName: string; approvedBy: string[]; needed: number } | null
  /** Kein Verschieben-Recht auf dem aktuellen Korb (Stefan 2026-07-08) — Auswahl ausgeblendet. */
  disabled?: boolean
  /** Text statt "kein Zugriff", falls disabled aus einem anderen Grund gesetzt wurde (z. B. KI-Bestätigung ausstehend). */
  disabledReason?: string
  /** Für die optionale Nachricht beim Verschieben (Stefan 2026-08-26) — ersetzt das separate "Nachricht an Kollegen"-Fenster. */
  colleagues: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [toUserId, setToUserId] = useState('')
  // Stefan 2026-08-26 ("nicht beim Klicken auf dem Korb abschicken, sondern
  // einen Button 'Verschieben' einbauen"): Zielkorb erst auswählen (markiert
  // ihn nur), tatsächlich verschoben wird erst über den eigenen Button unten
  // — vorher löste der Klick auf den Korbnamen selbst direkt den Versand aus,
  // was leicht zu einem versehentlichen Verschieben führen konnte.
  const [selectedBasketId, setSelectedBasketId] = useState('')

  async function move() {
    if (!selectedBasketId) return
    setBusy(true)
    setError('')
    const res = await fetch(`/api/invoices/${invoiceId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetBasketId: selectedBasketId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setBusy(false)
      setError(data.error ?? 'Fehler beim Verschieben')
      return
    }
    // Nachricht ans Verschieben gekoppelt (Stefan 2026-08-26) — nur bei
    // tatsächlichem Erfolg anhängen, damit bei einem fehlgeschlagenen
    // Verschieben keine verwaiste Nachricht ohne Zusammenhang entsteht.
    if (message.trim()) {
      await fetch(`/api/invoices/${invoiceId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim() || undefined, text: message.trim(), toUserId: toUserId || undefined }),
      }).catch(() => undefined)
    }
    setBusy(false)
    setOpen(false)
    if (data.moved === false) {
      // Vier-Augen-Korb: nur die Freigabe wurde erfasst, das Dokument liegt
      // noch im aktuellen Korb — hier bleibt man auf der Detailseite.
      window.alert(`Freigabe erfasst — noch ${data.approvalsNeeded} weitere Freigabe(n) nötig (Vier-Augen-Korb).`)
      router.refresh()
      return
    }
    // Stefan 2026-08-26: tatsächlich verschoben — das Dokument gehört jetzt
    // ggf. nicht mehr in die aktuell gefilterte Listenansicht, aus der man
    // kam. Vorher blieb man auf der Detailseite stehen und nur der
    // Korbname änderte sich, was verwirrend war.
    router.push('/invoices')
    router.refresh()
  }

  if (disabled) {
    return (
      <span className="text-[10px] text-gray-400" title={disabledReason ?? 'Kein Recht zum Verschieben aus diesem Korb'}>
        {disabledReason ? '⏳ noch nicht verschiebbar' : 'kein Zugriff'}
      </span>
    )
  }

  const targets = baskets.filter((b) => b.id !== currentBasketId)

  return (
    <>
      <button type="button" className="btn-secondary !px-2 !py-1 text-[11px]" onClick={() => { setSelectedBasketId(''); setOpen(true) }}
        disabled={busy || targets.length === 0} title="Diese Rechnung in einen anderen Korb verschieben">
        ↔ In anderen Korb verschieben
      </button>
      {pending && (
        <p className="w-full text-[10px] text-[var(--warn-strong)]">
          Freigabe für „{pending.targetName}" ausstehend ({pending.approvedBy.length}/2)
        </p>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-lg font-semibold text-gray-800">In welchen Korb verschieben?</h2>
            <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
              {targets.map((b) => (
                <button key={b.id} type="button" disabled={busy} onClick={() => setSelectedBasketId(b.id)}
                  aria-pressed={selectedBasketId === b.id}
                  className={`block w-full rounded-lg px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                    selectedBasketId === b.id
                      ? 'bg-[var(--accent)] text-white'
                      : 'hover:bg-[var(--surface-muted)]'
                  }`}>
                  {b.name}
                </button>
              ))}
            </div>
            {/* Nachricht optional beim Verschieben mitgeben (Stefan
                2026-08-26) — ersetzt das separate "Nachricht an Kollegen"-
                Fenster weiter unten auf der Seite. */}
            <div className="mt-3 space-y-2 border-t border-[var(--line)] pt-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Nachricht (optional)</p>
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
                  maxLength={4000} placeholder="z. B. Bitte Kostenstelle prüfen und ergänzen, bevor die Rechnung weiterläuft." />
              </div>
            </div>
            {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Abbrechen</button>
              <button type="button" className="btn-primary" onClick={move} disabled={busy || !selectedBasketId}
                title={selectedBasketId ? undefined : 'Bitte zuerst einen Zielkorb auswählen'}>
                {busy ? 'Verschiebe …' : 'Verschieben'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
