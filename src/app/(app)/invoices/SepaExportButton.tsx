'use client'

// SEPA-Sammelüberweisung für den Übergabekorb (Stefan 2026-08-27, Review-Fund
// "welche Export-Module an Fibu noch wichtig wären") — erzeugt aus den
// vollständig geprüften Rechnungen dieses Korbs eine pain.001-Datei zum
// Hochladen ins Online-Banking. Eigenständig neben dem DATEV-Export: setzt
// KEINEN Rechnungsstatus (kein "bezahlt"-Tracking, reine Datei-Erzeugung,
// beliebig wiederholbar), siehe api/invoices/export/sepa und lib/sepa.ts.
import { useState } from 'react'

type Candidate = {
  id: string
  docId: string | null
  vendor: string
  invoiceNumber: string | null
  amountGross: number | null
  currency: string
  directDebitByVendor: boolean
  iban: string | null
  bic: string | null
  ibanVerified: boolean
}

function tomorrowIso(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function SepaExportButton({ basketId, encryptionEnabled }: { basketId: string; encryptionEnabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [ownAccountConfigured, setOwnAccountConfigured] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [executionDate, setExecutionDate] = useState(tomorrowIso())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  async function openPanel() {
    setOpen(true)
    setLoading(true)
    setError('')
    setStatus('')
    const res = await fetch(`/api/invoices/export/sepa?basketId=${basketId}`)
    const data = await res.json().catch(() => ({}))
    setLoading(false)
    if (!res.ok) {
      setError(data.error ?? 'Laden fehlgeschlagen.')
      return
    }
    const list = (data.invoices ?? []) as Candidate[]
    setCandidates(list)
    setOwnAccountConfigured(Boolean(data.ownAccountConfigured))
    // Vorauswahl: nur zahlungsbereite Rechnungen (bestätigte IBAN, keine
    // Lastschrift durch den Lieferanten — die wird ohnehin nicht von uns
    // überwiesen, siehe Invoice.directDebitByVendor).
    setSelected(new Set(list.filter((c) => c.ibanVerified && c.iban && !c.directDebitByVendor).map((c) => c.id)))
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function generate() {
    if (selected.size === 0) {
      setError('Bitte mindestens eine Rechnung auswählen.')
      return
    }
    setBusy(true)
    setError('')
    setStatus('')
    const res = await fetch('/api/invoices/export/sepa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ basketId, invoiceIds: Array.from(selected), executionDate }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Erzeugen fehlgeschlagen.')
      return
    }
    const count = res.headers.get('X-Sepa-Count') ?? '0'
    const total = res.headers.get('X-Sepa-Total') ?? '0'
    const rejectedRaw = res.headers.get('X-Sepa-Rejected')
    const rejected = rejectedRaw ? decodeURIComponent(rejectedRaw) : ''
    setStatus(`${count} Zahlung(en), ${total} EUR erzeugt.${rejected ? ` Übersprungen: ${rejected}` : ''}`)

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `SEPA_Sammelueberweisung_${executionDate}.xml`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  if (encryptionEnabled) {
    return (
      <span className="text-xs text-gray-400" title="Der Server kann verschlüsselte Beleg-Daten nicht lesen (Zero-Knowledge)">
        SEPA-Export: bei Verschlüsselung noch nicht unterstützt
      </span>
    )
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary" onClick={openPanel}
        title="Aus den vollständig geprüften Rechnungen dieses Korbs eine SEPA-Sammelüberweisungsdatei (pain.001) erzeugen — zum Hochladen ins Online-Banking">
        💳 SEPA-Sammelüberweisung
      </button>
    )
  }

  return (
    <div className="dp-card w-full space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">SEPA-Sammelüberweisung</h3>
        <button type="button" className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>schließen</button>
      </div>
      {loading && <p className="text-xs text-gray-400">Lade …</p>}
      {!loading && !ownAccountConfigured && (
        <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn-strong)]">
          ⚠ Kein gültiges Auftraggeberkonto hinterlegt — bitte zuerst in den Mandanten-Einstellungen →
          DATEV-Export → „Zahlungsverkehr" IBAN eintragen.
        </p>
      )}
      {!loading && candidates.length === 0 && (
        <p className="text-xs text-gray-400">Keine vollständig geprüften Rechnungen mit Betrag in diesem Korb.</p>
      )}
      {!loading && candidates.length > 0 && (
        <>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--line)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--surface)]">
                <tr className="dp-tr">
                  <th className="dp-th">✓</th>
                  <th className="dp-th">Beleg</th>
                  <th className="dp-th">Lieferant</th>
                  <th className="dp-th">Betrag</th>
                  <th className="dp-th">Konto</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const payable = c.ibanVerified && c.iban && c.currency === 'EUR'
                  return (
                    <tr key={c.id} className="dp-tr">
                      <td className="dp-td">
                        <input type="checkbox" checked={selected.has(c.id)} disabled={!payable}
                          onChange={() => toggle(c.id)} />
                      </td>
                      <td className="dp-td font-mono">{c.docId ?? c.id.slice(0, 8)}</td>
                      <td className="dp-td">{c.vendor}</td>
                      <td className="dp-td">{c.amountGross?.toFixed(2)} {c.currency}</td>
                      <td className="dp-td">
                        {c.directDebitByVendor ? (
                          <span className="text-gray-400" title="Wird laut Rechnung per Lastschrift eingezogen, nicht überwiesen">Lastschrift</span>
                        ) : c.currency !== 'EUR' ? (
                          <span className="text-[var(--danger)]">Nicht EUR</span>
                        ) : !c.iban ? (
                          <span className="text-[var(--danger)]" title="Im Lieferanten-Register (Mandanten-Einstellungen → Allgemein) eintragen">keine IBAN</span>
                        ) : !c.ibanVerified ? (
                          <span className="text-[var(--warn-strong)]" title="Im Lieferanten-Register bestätigen">⚠ ungeprüft</span>
                        ) : (
                          <span className="text-[var(--accent)] font-mono">{c.iban.slice(0, 8)}…</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="dp-label">Ausführungsdatum</label>
              <input type="date" className="dp-input mt-1 !w-40" value={executionDate}
                onChange={(e) => setExecutionDate(e.target.value)} />
            </div>
            <button type="button" className="btn-primary" disabled={busy || !ownAccountConfigured}
              onClick={generate}>
              {busy ? 'Erzeuge …' : `Datei erzeugen (${selected.size})`}
            </button>
          </div>
        </>
      )}
      {error && <p className="text-xs text-[var(--danger)] whitespace-pre-line">{error}</p>}
      {status && <p className="text-xs text-[var(--accent)]">{status}</p>}
    </div>
  )
}
