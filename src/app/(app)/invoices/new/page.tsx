'use client'

// Elektronische Rechnung hinzufügen (RE02a): Upload einer bereits vorhandenen
// Datei (PDF, XML, Foto) + manuelle Felderfassung. E-Rechnungen (ZUGFeRD/
// XRechnung) werden automatisch erkannt. Für Papierbelege ohne Datei siehe
// RE02b (Papierrechnung scannen, /invoices/new/scan).
// Ist die Beleg-Verschlüsselung aktiv, wird die Datei VOR dem Upload im Browser
// verschlüsselt (Zero-Knowledge — Server sieht nur Chiffrat).
// Formaterkennung DIREKT NACH DER DATEIAUSWAHL (noch vor dem Speichern): bei
// ZUGFeRD/XRechnung sind die Daten schon strukturiert (keine KI nötig), bei
// einer "nackten" PDF oder einem Foto wird stattdessen "Mit KI ausfüllen"
// angeboten — spiegelt die gleiche Logik wie später auf der Detailseite
// (InvoiceEditForm.tsx, EINVOICE_FORMATS).
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { encryptBytes, sha256Hex } from '@/lib/clientCrypto'
import { EINVOICE_FORMATS, FORMAT_LABELS, type DocFormat } from '@/lib/docFormat'
import { fetchEncConfig, getCachedDek, unlockWithPassphrase } from '@/lib/keyStore'

const EMPTY = {
  vendor: '', invoiceNumber: '', invoiceDate: '', dueDate: '',
  amountNet: '', amountTax: '', amountGross: '', currency: 'EUR', tags: '', notes: '',
  directDebitByVendor: false,
}
const CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP']

function toInput(n: number | null): string {
  return n === null ? '' : String(n).replace('.', ',')
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
  const [detecting, setDetecting] = useState(false)
  const [detectedFormat, setDetectedFormat] = useState<DocFormat | null>(null)
  const [detectedValid, setDetectedValid] = useState<boolean | null>(null)
  const [aiAvailable, setAiAvailable] = useState(false)
  const [aiReason, setAiReason] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiWarnings, setAiWarnings] = useState<string[]>([])
  const [aiFlags, setAiFlags] = useState<string[]>([])
  const [usedAi, setUsedAi] = useState(false)

  useEffect(() => {
    fetchEncConfig().then(async (cfg) => {
      setEncEnabled(cfg.enabled)
      if (cfg.enabled) setLocked(!(await getCachedDek()))
    }).catch(() => undefined)
    fetch('/api/ai/config')
      .then((r) => r.json())
      .then((d) => {
        setAiAvailable(Boolean(d.available))
        setAiReason(d.reason ?? '')
      })
      .catch(() => undefined)
  }, [])

  const isEInvoice = detectedFormat ? (EINVOICE_FORMATS as string[]).includes(detectedFormat) : false
  const canOfferAi = Boolean(file) && !encEnabled && detectedFormat !== null && !isEInvoice

  async function onFileSelected(picked: File | null) {
    setFile(picked)
    setDetectedFormat(null)
    setDetectedValid(null)
    setAiFlags([])
    setAiWarnings([])
    setAiError('')
    setUsedAi(false)
    // Zero-Knowledge: bei aktiver Verschlüsselung darf die Datei den Browser
    // vor dem eigentlichen (verschlüsselten) Speichern nicht verlassen —
    // keine Sofort-Erkennung, Format wird dann erst nach dem Entschlüsseln
    // durch den Kunden selbst sichtbar (serverseitig nie analysierbar).
    if (!picked || encEnabled) return
    setDetecting(true)
    try {
      const fd = new FormData()
      fd.append('file', picked)
      const res = await fetch('/api/invoices/detect-format', { method: 'POST', body: fd })
      const data = await res.json()
      if (res.ok) {
        setDetectedFormat(data.format ?? null)
        setDetectedValid(data.validationOk ?? null)
        // ZUGFeRD/XRechnung: Felder sofort übernehmen statt erst beim
        // Speichern — die Daten sind ja schon aus dem eingebetteten XML
        // gelesen, kein Grund zu warten.
        const isEInv = data.format && (EINVOICE_FORMATS as string[]).includes(data.format)
        const d = data.data as {
          number: string | null; issueDate: string | null; dueDate: string | null
          sellerName: string | null; net: number | null; tax: number | null
          gross: number | null; currency: string | null
        } | null
        if (isEInv && d) {
          setF((p) => ({
            ...p,
            vendor: d.sellerName ?? p.vendor,
            invoiceNumber: d.number ?? p.invoiceNumber,
            invoiceDate: d.issueDate ?? p.invoiceDate,
            dueDate: d.dueDate ?? p.dueDate,
            amountNet: d.net !== null ? toInput(d.net) : p.amountNet,
            amountTax: d.tax !== null ? toInput(d.tax) : p.amountTax,
            amountGross: d.gross !== null ? toInput(d.gross) : p.amountGross,
            currency: d.currency && CURRENCIES.includes(d.currency) ? d.currency : p.currency,
          }))
        }
      }
    } catch {
      /* Sofort-Erkennung ist nur ein Komfort-Feature — Fehler hier blockieren nichts */
    } finally {
      setDetecting(false)
    }
  }

  async function fillWithAi() {
    if (!file) return
    setAiBusy(true)
    setAiError('')
    setAiWarnings([])
    setAiFlags([])
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/invoices/ai-extract', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setAiError(data.error ?? 'KI-Erkennung fehlgeschlagen.')
        return
      }
      const d = data.data as {
        vendor: string | null; invoiceNumber: string | null; invoiceDate: string | null
        dueDate: string | null; amountNet: number | null; amountTax: number | null
        amountGross: number | null; currency: string | null; tags: string | null
        directDebitByVendor: boolean | null
        uncertainFields: string[]; warnings: string[]
      }
      setF((p) => ({
        ...p,
        vendor: d.vendor ?? p.vendor,
        invoiceNumber: d.invoiceNumber ?? p.invoiceNumber,
        invoiceDate: d.invoiceDate ?? p.invoiceDate,
        dueDate: d.dueDate ?? p.dueDate,
        amountNet: d.amountNet !== null ? toInput(d.amountNet) : p.amountNet,
        amountTax: d.amountTax !== null ? toInput(d.amountTax) : p.amountTax,
        amountGross: d.amountGross !== null ? toInput(d.amountGross) : p.amountGross,
        currency: d.currency && CURRENCIES.includes(d.currency) ? d.currency : p.currency,
        tags: d.tags ?? p.tags,
        directDebitByVendor: d.directDebitByVendor ?? p.directDebitByVendor,
      }))
      setAiFlags(d.uncertainFields ?? [])
      setAiWarnings(d.warnings ?? [])
      setUsedAi(true)
    } catch {
      setAiError('KI-Erkennung fehlgeschlagen.')
    } finally {
      setAiBusy(false)
    }
  }

  const set = (key: keyof typeof EMPTY, value: string) => setF((p) => ({ ...p, [key]: value }))

  async function checkDuplicateFirst(fileHash: string | null): Promise<boolean> {
    // Dubletten-Vorabprüfung (Stefan 2026-07-08): fragt VOR dem Speichern nach,
    // statt eine vermutliche Dublette stillschweigend zu markieren.
    if (!fileHash && !(f.vendor && f.invoiceNumber)) return true
    try {
      const res = await fetch('/api/invoices/check-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileHash: fileHash ?? undefined,
          vendor: f.vendor || undefined,
          invoiceNumber: f.invoiceNumber || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.duplicate) return true
      const d = data.duplicate as { docId: string | null; vendor: string; invoiceNumber: string | null }
      return window.confirm(
        `Diese Rechnung scheint bereits erfasst zu sein (${d.docId ?? d.vendor}` +
        `${d.invoiceNumber ? ', Nr. ' + d.invoiceNumber : ''}).\n\n` +
        `Möchten Sie sie wirklich noch einmal übernehmen?`,
      )
    } catch {
      return true // Vorabprüfung ist nur ein Komfort-Feature — Fehler hier blockieren nichts
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      // Klartext-Hash schon hier bilden (unabhängig von Verschlüsselung) — wird
      // für die Dubletten-Vorabprüfung gebraucht und bei aktiver Verschlüsselung
      // gleich weiterverwendet.
      let plainHash: string | null = null
      if (file) {
        try { plainHash = await sha256Hex(await file.arrayBuffer()) } catch { /* Prüfung ist nur Komfort */ }
      }
      if (!(await checkDuplicateFirst(plainHash))) return

      const fd = new FormData()
      const { directDebitByVendor, ...textFields } = f
      Object.entries(textFields).forEach(([k, v]) => fd.append(k, v))
      if (usedAi) fd.append('aiAssisted', '1')
      if (directDebitByVendor) fd.append('directDebitByVendor', '1')
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
          const cipher = await encryptBytes(dek, plainBuffer)
          fd.append('file', new Blob([cipher as unknown as BlobPart]), `${file.name}.enc`)
          fd.append('encrypted', '1')
          fd.append('encOrigMime', file.type)
          // Klartext-Hash (s.o.) VOR dem Verschlüsseln gebildet — für Dubletten-
          // Erkennung, da das Chiffrat wegen des zufälligen IV bei jeder
          // Verschlüsselung einen anderen Hash ergäbe.
          if (plainHash) fd.append('fileHash', plainHash)
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
        <h1 className="text-lg font-semibold text-gray-900">Rechnung hinzufügen</h1>
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
          onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
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
        {detecting && <p className="mt-1 text-[11px] text-gray-400">Format wird erkannt …</p>}
        {!detecting && detectedFormat && isEInvoice && (
          <p className="mt-1 text-[11px] font-medium text-[var(--accent)]">
            ✓ {FORMAT_LABELS[detectedFormat]} erkannt — Felder unten wurden direkt übernommen, bitte prüfen
            {detectedValid === false ? ' (Pflichtangaben unvollständig)' : ''}.
          </p>
        )}
        {!detecting && detectedFormat && !isEInvoice && (
          <p className="mt-1 text-[11px] text-gray-500">
            {FORMAT_LABELS[detectedFormat]} — keine strukturierten Daten gefunden.
          </p>
        )}
      </div>

      {canOfferAi && aiAvailable && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2">
          <button type="button" className="btn-secondary" onClick={fillWithAi} disabled={aiBusy}>
            {aiBusy ? 'KI liest die Rechnung …' : '✨ Mit KI ausfüllen'}
          </button>
          <p className="text-[11px] text-gray-500">
            Liest den Beleg und befüllt die Felder unten inkl. Verschlagwortung — bitte prüfen.
          </p>
        </div>
      )}
      {canOfferAi && !aiAvailable && aiReason && (
        <p className="text-[11px] text-gray-400">KI-Erkennung nicht verfügbar: {aiReason}</p>
      )}
      {aiError && <p className="text-sm text-[var(--danger)]">{aiError}</p>}
      {aiWarnings.length > 0 && (
        <p className="rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn-strong)]">
          ⚠ Bitte besonders prüfen — {aiWarnings.join(' ')}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lieferant *" value={f.vendor} onChange={(v) => set('vendor', v)} required warn={aiFlags.includes('vendor')} />
        <Field label="Rechnungsnummer" value={f.invoiceNumber} onChange={(v) => set('invoiceNumber', v)} warn={aiFlags.includes('invoiceNumber')} />
        <Field label="Rechnungsdatum" type="date" value={f.invoiceDate} onChange={(v) => set('invoiceDate', v)} warn={aiFlags.includes('invoiceDate')} />
        {f.directDebitByVendor ? (
          <div>
            <label className="dp-label">Fälligkeit</label>
            <p className="dp-input mt-1 flex items-center text-gray-500" title="Lieferant bucht per Lastschrift/Abbuchung selbst ab">
              wird abgebucht
            </p>
          </div>
        ) : (
          <Field label="Fälligkeit" type="date" value={f.dueDate} onChange={(v) => set('dueDate', v)} warn={aiFlags.includes('dueDate')} />
        )}
        <Field label="Netto (z. B. 1.234,56)" value={f.amountNet} onChange={(v) => set('amountNet', v)} warn={aiFlags.includes('amountNet')} />
        <Field label="Steuer" value={f.amountTax} onChange={(v) => set('amountTax', v)} warn={aiFlags.includes('amountTax')} />
        <Field label="Brutto" value={f.amountGross} onChange={(v) => set('amountGross', v)} warn={aiFlags.includes('amountGross')} />
        <div>
          <label className="dp-label">Währung</label>
          <select className="dp-input mt-1" value={f.currency} onChange={(e) => set('currency', e.target.value)}>
            <option>EUR</option><option>USD</option><option>CHF</option><option>GBP</option>
          </select>
        </div>
        <Field label="Tags (kommagetrennt)" value={f.tags} onChange={(v) => set('tags', v)} warn={aiFlags.includes('tags')} />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={f.directDebitByVendor}
          onChange={(e) => setF((p) => ({ ...p, directDebitByVendor: e.target.checked }))} />
        Lieferant bucht per Lastschrift/Abbuchung selbst ab (statt Überweisung)
        {aiFlags.includes('directDebitByVendor') && (
          <span className="text-[var(--warn-strong)]" title="KI ist sich hier unsicher — bitte prüfen">⚠</span>
        )}
      </label>
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
  label, value, onChange, type = 'text', required, warn,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; warn?: boolean
}) {
  return (
    <div>
      <label className="dp-label">
        {label}
        {warn && <span className="ml-1 text-[var(--warn-strong)]" title="KI ist sich hier unsicher — bitte prüfen">⚠</span>}
      </label>
      <input
        className={`dp-input mt-1 ${warn ? 'border-[var(--warn-border)] bg-[var(--warn-bg)]' : ''}`}
        type={type} value={value} required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
