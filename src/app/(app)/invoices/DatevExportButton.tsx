'use client'

// Übergabe an die Fibu (Stefan 2026-07-08): löst den DATEV-Export für den
// Übergabekorb aus, lädt die CSV-Datei herunter und markiert die enthaltenen
// Rechnungen serverseitig als "An Buchhaltung übergeben"/Exportiert — siehe
// /api/invoices/export/datev und lib/datev.ts.
import { useRouter } from 'next/navigation'
import { useState } from 'react'

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

  async function run() {
    if (count === 0) {
      window.alert('Keine offenen Rechnungen mit Bruttobetrag in diesem Korb.')
      return
    }
    const mailNote = sendMails ? ' und zusätzlich je Beleg eine E-Mail an die Fibu senden' : ''
    if (!window.confirm(`${count} Rechnung(en) als DATEV-Buchungsstapel exportieren${mailNote} und als "An Buchhaltung übergeben" markieren?`)) {
      return
    }
    setBusy(true)
    setError('')
    setStatus('')
    try {
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
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `EXTF_Buchungsstapel_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      router.refresh()
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
      {fibuEmailConfigured && (
        <label className="flex items-center gap-1.5 text-xs text-gray-600"
          title="Zusätzlich zum CSV eine einzelne E-Mail je Beleg mit dem Original-Dokument im Anhang an die in den Einstellungen hinterlegte Fibu-Adresse senden">
          <input type="checkbox" checked={sendMails} onChange={(e) => setSendMails(e.target.checked)} />
          + Einzel-Mails je Beleg
        </label>
      )}
      {fibuEmailConfigured && sendMails && encryptionEnabled && (
        <span className="text-xs text-[var(--warn-strong)]"
          title="Zero-Knowledge: der Server kann verschlüsselte Belege nicht entschlüsseln, um sie an eine Mail anzuhängen">
          🔒 Beleg-Verschlüsselung aktiv — verschlüsselte Belege werden ohne Anhang verschickt (nur Daten)
        </span>
      )}
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
      {status && <span className="text-xs text-[var(--accent)]">{status}</span>}
    </div>
  )
}
