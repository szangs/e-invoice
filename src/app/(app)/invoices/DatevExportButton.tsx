'use client'

// Übergabe an die Fibu (Stefan 2026-07-08): löst den DATEV-Export für den
// Übergabekorb aus, lädt die CSV-Datei herunter und markiert die enthaltenen
// Rechnungen serverseitig als "An Buchhaltung übergeben"/Exportiert — siehe
// /api/invoices/export/datev und lib/datev.ts.
//
// Verschlüsselte Mandanten (Stefan 2026-07-09): der Server kennt Lieferant/
// Beträge dann nicht mehr im Klartext (nur contentEnc) — die CSV wird
// stattdessen im BROWSER aus den entschlüsselten Daten gebaut
// (buildDatevExport ist eine reine Funktion, siehe lib/datev.ts) und direkt
// heruntergeladen; anschließend werden nur noch die betroffenen IDs an den
// Server gemeldet, damit er sie als übergeben markiert/in die Ablage
// verschiebt. Einzel-Mails je Beleg sind für verschlüsselte Mandanten in
// diesem Schritt noch nicht unterstützt (Mail-Text bräuchte ebenfalls die
// entschlüsselten Daten) — Checkbox bleibt dafür ausgeblendet.
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { decryptJson } from '@/lib/clientCrypto'
import { buildDatevExport, type DatevSettings } from '@/lib/datev'
import { getCachedDek } from '@/lib/keyStore'

type Candidate = {
  id: string
  docId: string | null
  invoiceDate: string | null
  createdAt: string
  contentEnc: string | null
  vendor: string | null
  invoiceNumber: string | null
  amountNet: number | null
  amountTax: number | null
  amountGross: number | null
  currency: string
}

function downloadCsv(csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `EXTF_Buchungsstapel_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function toNumber(v?: string | null): number | null {
  if (!v) return null
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function DatevExportButton({
  basketId,
  count,
  fibuEmailConfigured,
  encryptionEnabled,
}: {
  basketId: string
  count: number
  fibuEmailConfigured: boolean
  encryptionEnabled: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [sendMails, setSendMails] = useState(false)

  async function runEncrypted() {
    const dek = await getCachedDek()
    if (!dek) {
      setError('Bitte zuerst oben in der Liste die Passphrase eingeben, um die Beträge zu entschlüsseln.')
      return
    }
    const res = await fetch(`/api/invoices/export/datev?basketId=${basketId}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? 'Export fehlgeschlagen.')
      return
    }
    const candidates = (data.invoices ?? []) as Candidate[]
    const resolved: {
      id: string; vendor: string; invoiceNumber: string | null; docId: string | null
      invoiceDate: Date | null; createdAt: Date
      amountNet: number | null; amountTax: number | null; amountGross: number | null; currency: string
    }[] = []
    for (const c of candidates) {
      let vendor = c.vendor
      let invoiceNumber = c.invoiceNumber
      let amountNet = c.amountNet
      let amountTax = c.amountTax
      let amountGross = c.amountGross
      let currency = c.currency
      if (c.contentEnc) {
        try {
          const dec = await decryptJson<{
            vendor?: string | null; invoiceNumber?: string | null
            amountNet?: string | null; amountTax?: string | null; amountGross?: string | null
            currency?: string | null
          }>(dek, c.contentEnc)
          vendor = dec.vendor ?? null
          invoiceNumber = dec.invoiceNumber ?? null
          amountNet = toNumber(dec.amountNet)
          amountTax = toNumber(dec.amountTax)
          amountGross = toNumber(dec.amountGross)
          currency = dec.currency || currency
        } catch {
          continue // nicht entschlüsselbar (falsche/keine Passphrase mehr) — überspringen
        }
      }
      if (amountGross === null) continue
      resolved.push({
        id: c.id,
        vendor: vendor || 'Unbekannt',
        invoiceNumber,
        docId: c.docId,
        invoiceDate: c.invoiceDate ? new Date(c.invoiceDate) : null,
        createdAt: new Date(c.createdAt),
        amountNet, amountTax, amountGross, currency,
      })
    }
    if (resolved.length === 0) {
      window.alert('Keine vollständig geprüften Rechnungen mit Bruttobetrag in diesem Korb zum Export.')
      return
    }
    if (!window.confirm(`${resolved.length} Rechnung(en) als DATEV-Buchungsstapel exportieren und als "An Buchhaltung übergeben" markieren?`)) {
      return
    }
    const csv = buildDatevExport(
      resolved,
      data.settings as DatevSettings,
      { exportedBy: data.exportedBy ?? '' },
      data.vendorAccounts ?? {},
    )
    downloadCsv(csv)
    const markRes = await fetch('/api/invoices/export/datev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ basketId, invoiceIds: resolved.map((r) => r.id) }),
    })
    if (!markRes.ok) {
      const d = await markRes.json().catch(() => ({}))
      setError(d.error ?? 'CSV wurde heruntergeladen, aber das Markieren als übergeben ist fehlgeschlagen — bitte erneut versuchen.')
      return
    }
    router.refresh()
  }

  async function runPlain() {
    if (count === 0) {
      window.alert('Keine offenen Rechnungen mit Bruttobetrag in diesem Korb.')
      return
    }
    const mailNote = sendMails ? ' und zusätzlich je Beleg eine E-Mail an die Fibu senden' : ''
    if (!window.confirm(`${count} Rechnung(en) als DATEV-Buchungsstapel exportieren${mailNote} und als "An Buchhaltung übergeben" markieren?`)) {
      return
    }
    const res = await fetch('/api/invoices/export/datev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ basketId, sendIndividualMails: sendMails }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Export fehlgeschlagen.')
      return
    }
    if (sendMails) {
      const sent = res.headers.get('X-Mail-Sent') ?? '0'
      const failed = res.headers.get('X-Mail-Failed') ?? '0'
      setStatus(`${sent} Einzel-Mail(s) an Fibu gesendet${Number(failed) > 0 ? `, ${failed} fehlgeschlagen` : ''}.`)
    }
    const csv = await res.text()
    downloadCsv(csv)
    router.refresh()
  }

  async function run() {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      if (encryptionEnabled) {
        await runEncrypted()
      } else {
        await runPlain()
      }
    } catch {
      setError('Export fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn-primary" onClick={run} disabled={busy}
        title="Alle offenen Rechnungen in diesem Korb als DATEV-Buchungsstapel (EXTF-CSV) exportieren und als an die Buchhaltung übergeben markieren — Format zuerst mit Steuerberater/Fibu gegenprüfen">
        {busy ? 'Exportiere …' : `📤 An Fibu übergeben (DATEV-Export${count ? ` · ${count}` : ''})`}
      </button>
      {!encryptionEnabled && fibuEmailConfigured && (
        <label className="flex items-center gap-1.5 text-xs text-gray-600"
          title="Zusätzlich zum CSV eine einzelne E-Mail je Beleg mit dem Original-Dokument im Anhang an die in den Einstellungen hinterlegte Fibu-Adresse senden">
          <input type="checkbox" checked={sendMails} onChange={(e) => setSendMails(e.target.checked)} />
          + Einzel-Mails je Beleg
        </label>
      )}
      {encryptionEnabled && fibuEmailConfigured && (
        <span className="text-xs text-gray-400" title="Für verschlüsselte Mandanten noch nicht verfügbar">
          Einzel-Mails je Beleg: bei Verschlüsselung noch nicht unterstützt
        </span>
      )}
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
      {status && <span className="text-xs text-[var(--accent)]">{status}</span>}
    </div>
  )
}
