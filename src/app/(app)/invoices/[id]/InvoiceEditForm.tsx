'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FileLink } from '@/components/crypto/FileLink'
import type { InvoiceDTO } from '@/lib/invoices'

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
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const set = (key: keyof typeof f, value: string) => setF((p) => ({ ...p, [key]: value }))

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
    if (!window.confirm('Rechnung wirklich löschen? Der Beleg wird mit entfernt.')) return
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

  return (
    <form onSubmit={save} className="dp-card max-w-2xl space-y-4">
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lieferant *" value={f.vendor} onChange={(v) => set('vendor', v)} required />
        <Field label="Rechnungsnummer" value={f.invoiceNumber} onChange={(v) => set('invoiceNumber', v)} />
        <Field label="Rechnungsdatum" type="date" value={f.invoiceDate} onChange={(v) => set('invoiceDate', v)} />
        <Field label="Fälligkeit" type="date" value={f.dueDate} onChange={(v) => set('dueDate', v)} />
        <Field label="Netto" value={f.amountNet} onChange={(v) => set('amountNet', v)} />
        <Field label="Steuer" value={f.amountTax} onChange={(v) => set('amountTax', v)} />
        <Field label="Brutto" value={f.amountGross} onChange={(v) => set('amountGross', v)} />
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
      <div>
        <label className="dp-label">Notizen</label>
        <textarea className="dp-input mt-1" rows={3} value={f.notes}
          onChange={(e) => set('notes', e.target.value)} />
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
