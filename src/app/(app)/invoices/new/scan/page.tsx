'use client'

// Papierrechnung scannen (RE02b): mehrere Seiten aufnehmen — per Smartphone-
// Kamera ODER als bereits gescannte Datei (z. B. von einem am PC
// angeschlossenen Scanner/Multifunktionsgerät) — und zu EINEM PDF-Beleg
// zusammenführen, danach wie gewohnt manuell erfassen.
// Ist bereits genau eine fertige PDF-Datei ausgewählt (typischer Scanner-
// Export), wird sie unverändert übernommen, damit ein eventueller Text-/
// OCR-Layer des Scanners erhalten bleibt. Bei Fotos/mehreren Dateien wird
// im Browser ein neues PDF zusammengesetzt (pdf-lib) — der Server sieht nur
// noch die fertige Datei.
// Ist die Beleg-Verschlüsselung aktiv, wird die Datei VOR dem Upload im
// Browser verschlüsselt (Zero-Knowledge — Server sieht nur Chiffrat).
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { encryptBytes, sha256Hex } from '@/lib/clientCrypto'
import { fetchEncConfig, getCachedDek, unlockWithPassphrase } from '@/lib/keyStore'

const EMPTY = {
  vendor: '', invoiceNumber: '', invoiceDate: '', dueDate: '',
  amountNet: '', amountTax: '', amountGross: '', currency: 'EUR', tags: '', notes: '',
  directDebitByVendor: false,
}

type ScanPage = { id: string; file: File; kind: 'image' | 'pdf'; previewUrl: string | null }

function toInput(n: number | null): string {
  return n === null ? '' : String(n).replace('.', ',')
}

const CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP']

const PAGE_W = 595.28 // A4 in pt
const PAGE_H = 841.89
const MARGIN = 20

/** Fasst die aufgenommenen Seiten zu einer einzigen Beleg-Datei zusammen. */
async function buildInvoiceFile(pages: ScanPage[]): Promise<File> {
  if (pages.length === 1 && pages[0].kind === 'pdf') {
    return new File([pages[0].file], 'papierrechnung-scan.pdf', { type: 'application/pdf' })
  }
  if (pages.length === 1 && pages[0].kind === 'image') {
    // Einzelfoto: Originalbild unverändert übernehmen (keine unnötige PDF-Verpackung).
    // Wichtig auch dafür, dass eine spätere KI-Erkennung auf dem gespeicherten
    // Beleg direkt möglich ist (Bild statt PDF).
    return pages[0].file
  }
  const { PDFDocument } = await import('pdf-lib')
  const out = await PDFDocument.create()
  // WICHTIG für Dubletten-Erkennung (Datei-Hash): pdf-lib setzt Erstellungs-/
  // Änderungsdatum sonst automatisch auf "jetzt" — bei zwei Zusammenführungen
  // mit identischem Bildinhalt entstünde trotzdem jedes Mal ein anderer Hash,
  // nur weil unser eigenes PDF-Zusammenführen einen neuen Zeitstempel schreibt.
  // Fester Wert macht das Ergebnis bei gleichem Inhalt bit-identisch.
  out.setCreationDate(new Date(0))
  out.setModificationDate(new Date(0))
  for (const p of pages) {
    const bytes = new Uint8Array(await p.file.arrayBuffer())
    if (p.kind === 'pdf') {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
      const copied = await out.copyPages(src, src.getPageIndices())
      copied.forEach((pg) => out.addPage(pg))
    } else {
      const isPng = p.file.type === 'image/png'
      const img = isPng ? await out.embedPng(bytes) : await out.embedJpg(bytes)
      const maxW = PAGE_W - MARGIN * 2
      const maxH = PAGE_H - MARGIN * 2
      const scale = Math.min(maxW / img.width, maxH / img.height, 1)
      const w = img.width * scale
      const h = img.height * scale
      const pg = out.addPage([PAGE_W, PAGE_H])
      pg.drawImage(img, { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, width: w, height: h })
    }
  }
  const bytes = await out.save()
  return new File([bytes as unknown as BlobPart], 'papierrechnung-scan.pdf', { type: 'application/pdf' })
}

export default function ScanInvoicePage() {
  const router = useRouter()
  const [f, setF] = useState(EMPTY)
  const [pages, setPages] = useState<ScanPage[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [encEnabled, setEncEnabled] = useState(false)
  const [locked, setLocked] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [aiAvailable, setAiAvailable] = useState(false)
  const [aiReason, setAiReason] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiWarnings, setAiWarnings] = useState<string[]>([])
  const [aiFlags, setAiFlags] = useState<string[]>([])
  const [usedAi, setUsedAi] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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

  // Objekt-URLs beim Verlassen der Seite wieder freigeben (Ref, damit die
  // Cleanup-Funktion beim Unmount den zuletzt aktuellen Stand sieht)
  const pagesRef = useRef<ScanPage[]>([])
  useEffect(() => {
    pagesRef.current = pages
  }, [pages])
  useEffect(() => {
    return () => pagesRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl))
  }, [])

  const set = (key: keyof typeof EMPTY, value: string) => setF((p) => ({ ...p, [key]: value }))

  function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // Feld leeren, damit dieselbe Aufnahme/Datei erneut ausgewählt werden kann
    const next: ScanPage[] = files.map((file) => {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        kind: isPdf ? 'pdf' : 'image',
        previewUrl: isPdf ? null : URL.createObjectURL(file),
      }
    })
    setPages((p) => [...p, ...next])
  }

  function removePage(id: string) {
    setPages((p) => {
      const found = p.find((x) => x.id === id)
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl)
      return p.filter((x) => x.id !== id)
    })
  }

  function move(id: string, dir: -1 | 1) {
    setPages((p) => {
      const i = p.findIndex((x) => x.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= p.length) return p
      const next = [...p]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  async function fillWithAi() {
    const firstPhoto = pages.find((p) => p.kind === 'image')
    if (!firstPhoto) {
      setAiError('KI-Erkennung braucht mindestens eine fotografierte Seite (kein PDF).')
      return
    }
    setAiBusy(true)
    setAiError('')
    setAiWarnings([])
    setAiFlags([])
    try {
      const fd = new FormData()
      fd.append('file', firstPhoto.file)
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

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (pages.length === 0) {
      setError('Bitte mindestens eine Seite aufnehmen oder auswählen.')
      return
    }
    setBusy(true)
    try {
      const file = await buildInvoiceFile(pages)
      const fd = new FormData()
      const { directDebitByVendor, ...textFields } = f
      Object.entries(textFields).forEach(([k, v]) => fd.append(k, v))
      fd.append('source', 'SCAN')
      if (usedAi) fd.append('aiAssisted', '1')
      if (directDebitByVendor) fd.append('directDebitByVendor', '1')
      if (encEnabled) {
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
        // Klartext-Hash VOR dem Verschlüsseln bilden — für Dubletten-Erkennung
        // (Chiffrat hat wegen zufälligem IV sonst bei jeder Verschlüsselung
        // einen anderen Hash, auch bei identischem Klartext).
        const plainHash = await sha256Hex(plainBuffer)
        const cipher = await encryptBytes(dek, plainBuffer)
        fd.append('file', new Blob([cipher as unknown as BlobPart]), `${file.name}.enc`)
        fd.append('encrypted', '1')
        fd.append('encOrigMime', file.type)
        fd.append('fileHash', plainHash)
      } else {
        fd.append('file', file)
      }
      const res = await fetch('/api/invoices', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Speichern fehlgeschlagen.')
        return
      }
      router.push('/invoices')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Seiten konnten nicht zusammengeführt werden.')
    } finally {
      setBusy(false)
    }
  }

  const photoCount = pages.filter((p) => p.kind === 'image').length
  const pdfCount = pages.filter((p) => p.kind === 'pdf').length

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Papierrechnung scannen</h1>
        <Link href="/invoices/new" className="text-xs text-[var(--accent)] underline">
          Stattdessen elektronische Rechnung hochladen
        </Link>
      </div>

      <div className="dp-card space-y-3">
        <p className="text-sm text-gray-600">
          Fotografieren Sie die Rechnung Seite für Seite mit dem Smartphone, oder wählen Sie
          bereits gescannte Dateien aus — z. B. von einem am PC angeschlossenen Scanner
          (mehrere Dateien auf einmal möglich). Die Seiten werden zu einem PDF zusammengeführt.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          multiple
          className="hidden"
          onChange={onFilesSelected}
        />
        <button type="button" className="btn-secondary" onClick={() => inputRef.current?.click()}>
          + Seite hinzufügen
        </button>

        {pages.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              {pages.length} Seite(n) erfasst
              {photoCount > 0 && ` · ${photoCount} Foto(s)`}
              {pdfCount > 0 && ` · ${pdfCount} PDF-Datei(en)`}
              {pdfCount > 1 || (pdfCount === 1 && photoCount > 0)
                ? ' — wird beim Speichern zu einem PDF zusammengeführt'
                : ''}
            </p>
            <ul className="flex flex-wrap gap-3">
              {pages.map((p, i) => (
                <li key={p.id} className="w-28 space-y-1 rounded-lg border border-[var(--line)] p-1.5 text-center">
                  {p.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.previewUrl} alt={`Seite ${i + 1}`} className="h-24 w-full rounded object-cover" />
                  ) : (
                    <div className="flex h-24 w-full items-center justify-center rounded bg-[var(--surface-muted)] text-[10px] text-gray-500">
                      📄 PDF
                    </div>
                  )}
                  <p className="truncate text-[10px] text-gray-500" title={p.file.name}>{p.file.name}</p>
                  <div className="flex items-center justify-center gap-1 text-[10px]">
                    <button type="button" className="text-gray-500 disabled:opacity-30" disabled={i === 0}
                      onClick={() => move(p.id, -1)} title="Nach vorn">▲</button>
                    <button type="button" className="text-gray-500 disabled:opacity-30" disabled={i === pages.length - 1}
                      onClick={() => move(p.id, 1)} title="Nach hinten">▼</button>
                    <button type="button" className="text-[var(--danger)]" onClick={() => removePage(p.id)} title="Entfernen">✕</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {encEnabled && (
          <p className="text-[11px] font-medium text-[var(--accent)]">
            🔒 Beleg-Verschlüsselung aktiv — die zusammengeführte PDF-Datei wird vor dem Upload in
            Ihrem Browser verschlüsselt.
          </p>
        )}
        {encEnabled && locked && pages.length > 0 && (
          <div>
            <label className="dp-label">Verschlüsselungs-Passphrase (bleibt im Browser)</label>
            <input type="password" className="dp-input mt-1" value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)} />
          </div>
        )}
      </div>

      <form onSubmit={submit} className="dp-card space-y-4">
        {pages.length > 0 && aiAvailable ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2">
            <button type="button" className="btn-secondary" onClick={fillWithAi} disabled={aiBusy}>
              {aiBusy ? 'KI liest die Rechnung …' : '✨ Mit KI ausfüllen'}
            </button>
            <p className="text-[11px] text-gray-500">
              Liest die erste fotografierte Seite und befüllt die Felder unten inkl. Verschlagwortung
              (Tags) — bitte prüfen und korrigieren.
            </p>
          </div>
        ) : (
          <p className="text-xs text-gray-400">
            {pages.length > 0 && aiReason
              ? `KI-Ausfüllhilfe nicht verfügbar: ${aiReason}`
              : 'Automatische Datenerkennung gibt es nur bei elektronischen Rechnungen — bitte die Angaben unten aus der Papierrechnung übernehmen.'}
          </p>
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
          <button type="submit" className="btn-primary" disabled={busy || pages.length === 0}>
            {busy ? 'Speichere …' : 'Rechnung speichern'}
          </button>
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
