'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { FileLink } from '@/components/crypto/FileLink'
import { EINVOICE_FORMATS } from '@/lib/docFormat'
import type { InvoiceDTO } from '@/lib/invoices'

const AI_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp']
const CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP']

const STATUS_OPTIONS = [
  { value: 'NEW', label: 'Neu' },
  { value: 'CHECKED', label: 'Geprüft' },
  { value: 'EXPORTED', label: 'Exportiert' },
  { value: 'REJECTED', label: 'Abgelehnt' },
]

function toInput(n: number | null): string {
  return n === null ? '' : String(n).replace('.', ',')
}
function toNumber(v: string): number | null {
  if (!v.trim()) return null
  const n = Number(v.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function InvoiceEditForm({ invoice }: { invoice: InvoiceDTO }) {
  const router = useRouter()
  const [f, setF] = useState({
    vendor: invoice.vendor,
    invoiceNumber: invoice.invoiceNumber ?? '',
    invoiceDate: invoice.invoiceDate ?? '',
    dueDate: invoice.dueDate ?? '',
    amountNet: toInput(invoice.amountNet),
    amountTax: toInput(invoice.amountTax),
    amountGross: toInput(invoice.amountGross),
    currency: invoice.currency,
    status: invoice.status as string,
    tags: invoice.tags ?? '',
    notes: invoice.notes ?? '',
    directDebitByVendor: invoice.directDebitByVendor,
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  // KI-Erkennung anbieten bei: Fotos/Scans (Bild) ODER "nackter" PDF (kein
  // eingebettetes E-Rechnungs-XML) — NICHT bei ZUGFeRD/XRechnung, die haben
  // die Daten schon strukturiert. Nackte PDFs werden serverseitig vor der
  // KI-Anfrage gerastert (lib/pdfRaster.ts).
  const isEInvoice = (EINVOICE_FORMATS as string[]).includes(invoice.docFormat ?? '')
  const isImage = AI_IMAGE_MIMES.includes(invoice.mimeType ?? '')
  const isPlainPdf = invoice.mimeType === 'application/pdf' && !isEInvoice
  const canUseAi = invoice.hasFile && !invoice.encrypted && (isImage || isPlainPdf)
  const [aiAvailable, setAiAvailable] = useState(false)
  const [aiReason, setAiReason] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiWarnings, setAiWarnings] = useState<string[]>([])
  const [aiFlags, setAiFlags] = useState<string[]>([])
  const [usedAi, setUsedAi] = useState(false)

  useEffect(() => {
    if (!canUseAi) return
    fetch(`/api/ai/config?invoiceId=${invoice.id}`)
      .then((r) => r.json())
      .then((d) => {
        setAiAvailable(Boolean(d.available))
        setAiReason(d.reason ?? '')
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseAi, invoice.id])

  const set = (key: keyof typeof f, value: string) => setF((p) => ({ ...p, [key]: value }))

  async function fillWithAi() {
    setAiBusy(true)
    setAiError('')
    setAiWarnings([])
    setAiFlags([])
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/ai-extract`, { method: 'POST' })
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
      setMsg('KI-Vorschlag übernommen — bitte prüfen und speichern.')
    } catch {
      setAiError('KI-Erkennung fehlgeschlagen.')
    } finally {
      setAiBusy(false)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendor: f.vendor,
        invoiceNumber: f.invoiceNumber || null,
        invoiceDate: f.invoiceDate || null,
        dueDate: f.dueDate || null,
        amountNet: toNumber(f.amountNet),
        amountTax: toNumber(f.amountTax),
        amountGross: toNumber(f.amountGross),
        currency: f.currency,
        status: f.status,
        tags: f.tags || null,
        notes: f.notes || null,
        directDebitByVendor: f.directDebitByVendor,
        ...(usedAi ? { aiAssisted: true } : {}),
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setMsg(data.error ?? 'Speichern fehlgeschlagen.')
      return
    }
    setMsg('Gespeichert.')
    router.refresh()
  }

  async function remove() {
    if (!window.confirm('Rechnung wirklich löschen? Sie wird nur als gelöscht markiert (nicht endgültig entfernt) und kann im Papierkorb wiederhergestellt werden.')) return
    setBusy(true)
    const res = await fetch(`/api/invoices/${invoice.id}`, { method: 'DELETE' })
    setBusy(false)
    if (res.ok) {
      router.push('/invoices')
      router.refresh()
    } else {
      setMsg('Löschen fehlgeschlagen.')
    }
  }

  async function restore() {
    setBusy(true)
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restore: true }),
    })
    setBusy(false)
    if (res.ok) router.refresh()
    else setMsg('Wiederherstellen fehlgeschlagen.')
  }

  async function unmarkDuplicate() {
    setBusy(true)
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duplicateOfId: null }),
    })
    setBusy(false)
    if (res.ok) router.refresh()
  }

  async function toggleCheck(key: 'checkElectronic' | 'checkFormal', value: boolean) {
    setBusy(true)
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    })
    setBusy(false)
    if (res.ok) router.refresh()
    else setMsg('Prüfschritt konnte nicht gespeichert werden.')
  }

  if (invoice.deletedAt) {
    return (
      <div className="dp-card max-w-2xl space-y-3">
        <p className="text-sm font-semibold text-[var(--danger)]">
          Diese Rechnung wurde am {new Date(invoice.deletedAt).toLocaleString('de-DE')}
          {invoice.deletedBy ? ` von ${invoice.deletedBy}` : ''} als gelöscht markiert.
        </p>
        <p className="text-xs text-gray-500">Der Beleg und alle Daten sind weiterhin vorhanden — nichts wurde endgültig entfernt.</p>
        <div className="flex gap-2">
          <button type="button" className="btn-primary" onClick={restore} disabled={busy}>
            {busy ? '…' : 'Wiederherstellen'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => router.push('/invoices')}>Zurück</button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={save} className="dp-card max-w-2xl space-y-4">
      {invoice.docId && (
        <p className="font-mono text-[11px] text-gray-400" title="Eindeutige Dokumenten-ID (GoBD-Referenzierung)">
          {invoice.docId}
        </p>
      )}
      {invoice.duplicateOfId && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2">
          <p className="text-xs font-semibold text-[var(--warn-strong)]">
            Als Dublette erkannt —{' '}
            <a className="underline" href={`/invoices/${invoice.duplicateOfId}`}>Original öffnen</a>
          </p>
          <button type="button" className="btn-secondary !px-2 !py-1 text-xs" onClick={unmarkDuplicate} disabled={busy}>
            Keine Dublette
          </button>
        </div>
      )}
      {invoice.hasFile && (
        <p className="text-sm">
          Beleg:{' '}
          <FileLink
            invoiceId={invoice.id}
            encrypted={invoice.encrypted}
            origMime={invoice.origMime}
            label={invoice.originalName ?? 'öffnen'}
          />
        </p>
      )}
      {canUseAi && aiAvailable && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2">
          <button type="button" className="btn-secondary" onClick={fillWithAi} disabled={aiBusy}>
            {aiBusy ? 'KI liest die Rechnung …' : '✨ Mit KI erkennen'}
          </button>
          <p className="text-[11px] text-gray-500">
            Liest den Beleg nachträglich per KI aus und befüllt die Felder unten (auch
            Verschlagwortung) — bitte prüfen und speichern.
          </p>
        </div>
      )}
      {canUseAi && !aiAvailable && aiReason && (
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
        <Field label="Netto" value={f.amountNet} onChange={(v) => set('amountNet', v)} warn={aiFlags.includes('amountNet')} />
        <Field label="Steuer" value={f.amountTax} onChange={(v) => set('amountTax', v)} warn={aiFlags.includes('amountTax')} />
        <Field label="Brutto" value={f.amountGross} onChange={(v) => set('amountGross', v)} warn={aiFlags.includes('amountGross')} />
        <div>
          <label className="dp-label">Währung</label>
          <select className="dp-input mt-1" value={f.currency} onChange={(e) => set('currency', e.target.value)}>
            <option>EUR</option><option>USD</option><option>CHF</option><option>GBP</option>
          </select>
        </div>
        <div>
          <label className="dp-label">Status</label>
          <select className="dp-input mt-1" value={f.status} onChange={(e) => set('status', e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <Field label="Tags" value={f.tags} onChange={(v) => set('tags', v)} />
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

      <div className="border-t border-[var(--line)] pt-3">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Rechnungsprüfung</h3>
        <div className="space-y-1.5">
          <CheckRow
            label="Elektronische Vorprüfung"
            at={invoice.checkElectronicAt} by={invoice.checkElectronicBy}
            busy={busy} onToggle={(v) => toggleCheck('checkElectronic', v)}
          />
          <CheckRow
            label="Formal richtig"
            at={invoice.checkFormalAt} by={invoice.checkFormalBy}
            busy={busy} onToggle={(v) => toggleCheck('checkFormal', v)}
          />
        </div>
        <p className="mt-2 text-[11px] text-gray-400">
          „Sachlich richtig" und „An Buchhaltung übergeben" werden in der Rechnungsliste abgehakt
          (Buchhaltungs-Schritte, nicht Teil der Erfassung).
        </p>
      </div>
      {msg && (
        <p className={`text-sm ${msg === 'Gespeichert.' ? 'text-[var(--accent)]' : 'text-[var(--danger)]'}`}>{msg}</p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Speichere …' : 'Speichern'}</button>
        <button type="button" className="btn-secondary" onClick={() => router.push('/invoices')}>Zurück</button>
        <button type="button" className="btn-danger ml-auto" onClick={remove} disabled={busy}>Löschen</button>
      </div>
    </form>
  )
}

function CheckRow({
  label, at, by, busy, onToggle,
}: {
  label: string; at: string | null; by: string | null; busy: boolean; onToggle: (v: boolean) => void
}) {
  const checked = at !== null
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" checked={checked} disabled={busy} className="accent-green-600"
        onChange={(e) => onToggle(e.target.checked)} />
      {checked && <span className="text-green-600">✓</span>}
      {label}
      {checked && (
        <span className="text-[11px] text-gray-400">
          — {by} am {new Date(at as string).toLocaleString('de-DE')}
        </span>
      )}
    </label>
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
