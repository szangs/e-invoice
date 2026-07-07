'use client'

// Elektronische Rechnung hinzufügen (RE02a): Upload einer bereits vorhandenen
// Datei (PDF, XML, Foto) + manuelle Felderfassung. E-Rechnungen (ZUGFeRD/
// XRechnung) werden automatisch erkannt. Für Papierbelege ohne Datei siehe
// RE02b (Papierrechnung scannen, /invoices/new/scan).
// Ist die Beleg-Verschlüsselung aktiv, wird die Datei VOR dem Upload im Browser
// verschlüsselt (Zero-Knowledge — Server sieht nur Chiffrat).
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { encryptBytes, sha256Hex } from '@/lib/clientCrypto'
import { fetchEncConfig, getCachedDek, unlockWithPassphrase } from '@/lib/keyStore'

const EMPTY = {
  vendor: '', invoiceNumber: '', invoiceDate: '', dueDate: '',
  amountNet: '', amountTax: '', amountGross: '', currency: 'EUR', tags: '', notes: '',
}

export default function NewInvoicePage() {
  const router = useRouter()
  const [f, setF] = useState(EMPTY)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [encEnabled, setEncEnabled] = useState(false)
  const [locked, setLocked] = useState(false)
  const [passphrase, setPassphrase] = useState('')

  useEffect(() => {
    fetchEncConfig().then(async (cfg) => {
      setEncEnabled(cfg.enabled)
      if (cfg.enabled) setLocked(!(await getCachedDek()))
    }).catch(() => undefined)
  }, [])

  const set = (key: keyof typeof EMPTY, value: string) => setF((p) => ({ ...p, [key]: value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const fd = new FormData()
      Object.entries(f).forEach(([k, v]) => fd.append(k, v))
      if (file) {
        if (encEnabled) {
          // Beleg im Browser verschlüsseln — Schlüssel verlässt den Browser nicht
          let dek = await getCachedDek()
          if (!dek) {
            try {
              dek = await unlockWithPassphrase(passphrase)
              setLocked(false)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Passphrase falsch.')
              return
            }
          }
          const plainBuffer = await file.arrayBuffer()
          // Klartext-Hash VOR dem Verschlüsseln bilden — für Dubletten-Erkennung.
          // Das Chiffrat hat wegen des zufälligen IV bei jeder Verschlüsselung
          // einen anderen Hash, auch bei identischem Klartext.
          const plainHash = await sha256Hex(plainBuffer)
          const cipher = await encryptBytes(dek, plainBuffer)
          fd.append('file', new Blob([cipher as unknown as BlobPart]), `${file.name}.enc`)
          fd.append('encrypted', '1')
          fd.append('encOrigMime', file.type)
          fd.append('fileHash', plainHash)
        } else {
          fd.append('file', file)
        }
      }
      const res = await fetch('/api/invoices', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Speichern fehlgeschlagen.')
        return
      }
      router.push('/invoices')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Elektronische Rechnung hinzufügen</h1>
        <Link href="/invoices/new/scan" className="text-xs text-[var(--accent)] underline">
          Stattdessen Papierrechnung scannen
        </Link>
      </div>
    <form onSubmit={submit} className="dp-card space-y-4">
      <div>
        <label className="dp-label">Beleg (PDF, XML, PNG, JPG, WebP — max. 10 MB)</label>
        <input
          type="file"
          accept="application/pdf,application/xml,text/xml,.xml,image/png,image/jpeg,image/webp"
          className="dp-input mt-1"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p className="mt-0.5 text-[10px] text-gray-400">
          E-Rechnungen (ZUGFeRD/XRechnung) werden automatisch erkannt — Daten wie Nummer,
          Datum und Beträge werden übernommen, leere Felder kannst du hier vorbelegen.
        </p>
        {encEnabled && (
          <p className="mt-1 text-[11px] font-medium text-[var(--accent)]">
            🔒 Beleg-Verschlüsselung aktiv — die Datei wird vor dem Upload in Ihrem Browser verschlüsselt.
          </p>
        )}
        {encEnabled && locked && file && (
          <div className="mt-2">
            <label className="dp-label">Verschlüsselungs-Passphrase (bleibt im Browser)</label>
            <input type="password" className="dp-input mt-1" value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)} />
          </div>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lieferant *" value={f.vendor} onChange={(v) => set('vendor', v)} required />
        <Field label="Rechnungsnummer" value={f.invoiceNumber} onChange={(v) => set('invoiceNumber', v)} />
        <Field label="Rechnungsdatum" type="date" value={f.invoiceDate} onChange={(v) => set('invoiceDate', v)} />
        <Field label="Fälligkeit" type="date" value={f.dueDate} onChange={(v) => set('dueDate', v)} />
        <Field label="Netto (z. B. 1.234,56)" value={f.amountNet} onChange={(v) => set('amountNet', v)} />
        <Field label="Steuer" value={f.amountTax} onChange={(v) => set('amountTax', v)} />
        <Field label="Brutto" value={f.amountGross} onChange={(v) => set('amountGross', v)} />
        <div>
          <label className="dp-label">Währung</label>
          <select className="dp-input mt-1" value={f.currency} onChange={(e) => set('currency', e.target.value)}>
            <option>EUR</option><option>USD</option><option>CHF</option><option>GBP</option>
          </select>
        </div>
        <Field label="Tags (kommagetrennt)" value={f.tags} onChange={(v) => set('tags', v)} />
      </div>
      <div>
        <label className="dp-label">Notizen</label>
        <textarea className="dp-input mt-1" rows={3} value={f.notes}
          onChange={(e) => set('notes', e.target.value)} />
      </div>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Speichere …' : 'Rechnung speichern'}</button>
        <button type="button" className="btn-secondary" onClick={() => router.push('/invoices')}>Abbrechen</button>
      </div>
    </form>
    </div>
  )
}

function Field({
  label, value, onChange, type = 'text', required,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean
}) {
  return (
    <div>
      <label className="dp-label">{label}</label>
      <input className="dp-input mt-1" type={type} value={value} required={required}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
