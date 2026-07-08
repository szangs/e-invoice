'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { FileLink } from '@/components/crypto/FileLink'
import { EINVOICE_FORMATS } from '@/lib/docFormat'
import type { InvoiceDTO } from '@/lib/invoices'
import { BasketMoveSelect } from '../BasketMoveSelect'
import { AttachmentsPanel } from './AttachmentsPanel'
import { InvoiceNotesPanel } from './InvoiceNotesPanel'

const AI_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp']
const CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP']

// Steuerlich relevante Felder bei ZUGFeRD/XRechnung sind gesperrt (Stefan
// 2026-07-08): das XML ist das rechtsverbindliche Original — würde man
// Lieferant, Nummer, Datum oder Beträge hier überschreiben, würde die Anzeige
// vom Original abweichen (GoBD-Unveränderbarkeit/Nachvollziehbarkeit). Bei
// Papierrechnungen/Scans (keine strukturierte Quelle) gilt diese Sperre NICHT.
// Notizen, Tags, Status, Zahlungsart und Korb bleiben immer frei editierbar —
// das ist unsere eigene Workflow-Metadaten-Ebene, keine Rechnungsdaten.
const LOCK_REASON =
  'Aus der elektronischen Rechnung (ZUGFeRD/XRechnung) automatisch übernommen — laut GoBD nicht änderbar, ' +
  'da die Anzeige sonst vom rechtsverbindlichen Original abweichen würde.'

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

export function InvoiceEditForm({
  invoice,
  baskets,
  pendingApproval,
  encryptionEnabled,
  colleagues,
}: {
  invoice: InvoiceDTO
  baskets: { id: string; name: string }[]
  pendingApproval: { targetName: string; approvedBy: string[]; needed: number } | null
  encryptionEnabled: boolean
  colleagues: { id: string; name: string }[]
}) {
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
  // Bild-Abgleich (Stefan 2026-07-08): nur bei ZUGFeRD/Factur-X sinnvoll — da
  // steckt ein sichtbares PDF-Bild UND ein XML im selben Beleg, beide sollten
  // übereinstimmen. Reine XRechnung (nur XML, kein eigenes Bild) hat nichts
  // zum Gegenprüfen.
  const canCompareXml = invoice.hasFile && !invoice.encrypted && invoice.docFormat === 'ZUGFERD' && invoice.mimeType === 'application/pdf'
  const [aiAvailable, setAiAvailable] = useState(false)
  const [aiReason, setAiReason] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiWarnings, setAiWarnings] = useState<string[]>([])
  const [aiFlags, setAiFlags] = useState<string[]>([])
  const [usedAi, setUsedAi] = useState(false)
  const [compareBusy, setCompareBusy] = useState(false)
  const [compareError, setCompareError] = useState('')
  const [compareResult, setCompareResult] = useState<{ field: string; label: string; xmlValue: string; aiValue: string }[] | null>(null)

  useEffect(() => {
    if (!canUseAi && !canCompareXml) return
    fetch(`/api/ai/config?invoiceId=${invoice.id}`)
      .then((r) => r.json())
      .then((d) => {
        setAiAvailable(Boolean(d.available))
        setAiReason(d.reason ?? '')
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseAi, canCompareXml, invoice.id])

  async function compareXml() {
    setCompareBusy(true)
    setCompareError('')
    setCompareResult(null)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/xml-compare`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setCompareError(data.error ?? 'Abgleich fehlgeschlagen.')
        return
      }
      setCompareResult(data.deviations ?? [])
    } catch {
      setCompareError('Abgleich fehlgeschlagen.')
    } finally {
      setCompareBusy(false)
    }
  }

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
          <button type="button" className="btn-primary" onClick={restore} disabled={busy}
            title="Löschmarkierung aufheben — Rechnung erscheint wieder in der normalen Liste">
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
      {baskets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2">
          <span className="dp-label">Korb:</span>
          <span className="text-sm">{baskets.find((b) => b.id === invoice.basketId)?.name ?? '—'}</span>
          <BasketMoveSelect
            invoiceId={invoice.id}
            currentBasketId={invoice.basketId}
            baskets={baskets}
            pending={pendingApproval}
          />
        </div>
      )}
      {invoice.duplicateOfId && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2">
          <p className="text-xs font-semibold text-[var(--warn-strong)]">
            Als Dublette erkannt —{' '}
            <a className="underline" href={`/invoices/${invoice.duplicateOfId}`}>Original öffnen</a>
          </p>
          <button type="button" className="btn-secondary !px-2 !py-1 text-xs" onClick={unmarkDuplicate} disabled={busy}
            title="Dubletten-Markierung aufheben — diese Rechnung wird als eigenständig behandelt">
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
          <button type="button" className="btn-secondary" onClick={fillWithAi} disabled={aiBusy}
            title="Beleg per KI auslesen und Felder unten vorschlagen — Ergebnis bitte immer gegenprüfen">
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
        <Field label="Lieferant *" value={f.vendor} onChange={(v) => set('vendor', v)} required
          warn={aiFlags.includes('vendor')} locked={isEInvoice} lockReason={LOCK_REASON} />
        <Field label="Rechnungsnummer" value={f.invoiceNumber} onChange={(v) => set('invoiceNumber', v)}
          warn={aiFlags.includes('invoiceNumber')} locked={isEInvoice} lockReason={LOCK_REASON} />
        <Field label="Rechnungsdatum" type="date" value={f.invoiceDate} onChange={(v) => set('invoiceDate', v)}
          warn={aiFlags.includes('invoiceDate')} locked={isEInvoice} lockReason={LOCK_REASON} />
        {f.directDebitByVendor ? (
          <div>
            <label className="dp-label">Fälligkeit</label>
            <p className="dp-input mt-1 flex items-center text-gray-500" title="Lieferant bucht per Lastschrift/Abbuchung selbst ab">
              wird abgebucht
            </p>
          </div>
        ) : (
          <Field label="Fälligkeit" type="date" value={f.dueDate} onChange={(v) => set('dueDate', v)}
            warn={aiFlags.includes('dueDate')} locked={isEInvoice} lockReason={LOCK_REASON} />
        )}
        <Field label="Netto" value={f.amountNet} onChange={(v) => set('amountNet', v)}
          warn={aiFlags.includes('amountNet')} locked={isEInvoice} lockReason={LOCK_REASON} />
        <Field label="Steuer" value={f.amountTax} onChange={(v) => set('amountTax', v)}
          warn={aiFlags.includes('amountTax')} locked={isEInvoice} lockReason={LOCK_REASON} />
        <Field label="Brutto" value={f.amountGross} onChange={(v) => set('amountGross', v)}
          warn={aiFlags.includes('amountGross')} locked={isEInvoice} lockReason={LOCK_REASON} />
        <div>
          <label className="dp-label">
            Währung
            {isEInvoice && <span className="ml-1 text-gray-400" title={LOCK_REASON}>🔒</span>}
          </label>
          {isEInvoice ? (
            <p className="dp-input mt-1 flex items-center bg-[var(--surface-muted)] text-gray-500" title={LOCK_REASON}>
              {f.currency}
            </p>
          ) : (
            <select className="dp-input mt-1" value={f.currency} onChange={(e) => set('currency', e.target.value)}
              title="Rechnungswährung">
              <option>EUR</option><option>USD</option><option>CHF</option><option>GBP</option>
            </select>
          )}
        </div>
        <div>
          <label className="dp-label">Status</label>
          <select className="dp-input mt-1" value={f.status} onChange={(e) => set('status', e.target.value)}
            title="Bearbeitungsstatus für den internen Workflow — jederzeit frei änderbar">
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <Field label="Tags" value={f.tags} onChange={(v) => set('tags', v)} />
      </div>
      {isEInvoice && (
        <p className="text-[11px] text-gray-400">
          🔒 Gesperrte Felder stammen aus der elektronischen Rechnung und sind laut GoBD nicht änderbar.
          Notizen, Tags, Status, Zahlungsart und Korb sind davon nicht betroffen und bleiben frei editierbar.
        </p>
      )}
      {canCompareXml && aiAvailable && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" onClick={compareXml} disabled={compareBusy}
              title="Liest das PDF-Bild per KI und vergleicht es mit den aus dem XML übernommenen Feldern oben — reine Plausibilitätsprüfung, ändert nichts an den gespeicherten Daten">
              {compareBusy ? 'Vergleiche Bild mit XML …' : '🔍 Bild mit XML abgleichen'}
            </button>
            <p className="text-[11px] text-gray-500">
              Prüft per KI-Bilderkennung, ob das sichtbare PDF-Bild von den oben gesperrten XML-Werten abweicht.
            </p>
          </div>
          {compareError && <p className="mt-1.5 text-sm text-[var(--danger)]">{compareError}</p>}
          {compareResult && compareResult.length === 0 && (
            <p className="mt-1.5 text-xs font-medium text-[var(--accent)]">✓ Keine Abweichungen gefunden — Bild und XML stimmen überein.</p>
          )}
          {compareResult && compareResult.length > 0 && (
            <div className="mt-1.5 rounded-lg bg-[var(--warn-bg)] px-2.5 py-2">
              <p className="text-xs font-semibold text-[var(--warn-strong)]">
                ⚠ {compareResult.length} Abweichung{compareResult.length === 1 ? '' : 'en'} zwischen Bild und XML — bitte prüfen:
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-[var(--warn-strong)]">
                {compareResult.map((d) => (
                  <li key={d.field}>
                    <span className="font-medium">{d.label}:</span> XML „{d.xmlValue}" vs. Bild „{d.aiValue}"
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {canCompareXml && !aiAvailable && aiReason && (
        <p className="text-[11px] text-gray-400">Bild-Abgleich nicht verfügbar: {aiReason}</p>
      )}
      <label className="flex items-center gap-2 text-sm text-gray-700"
        title="Zahlungsart ist keine steuerlich relevante Angabe der Rechnung — immer frei änderbar">
        <input type="checkbox" checked={f.directDebitByVendor}
          onChange={(e) => setF((p) => ({ ...p, directDebitByVendor: e.target.checked }))} />
        Lieferant bucht per Lastschrift/Abbuchung selbst ab (statt Überweisung)
        {aiFlags.includes('directDebitByVendor') && (
          <span className="text-[var(--warn-strong)]" title="KI ist sich hier unsicher — bitte prüfen">⚠</span>
        )}
      </label>
      <div>
        <label className="dp-label" title="Interne Notiz, Kontierung oder ergänzende Information — nicht Teil der Rechnung selbst, immer frei editierbar">
          Notizen (z. B. Kontierung, interne Vermerke)
        </label>
        <textarea className="dp-input mt-1" rows={3} value={f.notes}
          title="Interne Notiz, Kontierung oder ergänzende Information — nicht Teil der Rechnung selbst, immer frei editierbar"
          onChange={(e) => set('notes', e.target.value)} />
      </div>

      <div className="border-t border-[var(--line)] pt-3">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Rechnungsprüfung</h3>
        <div className="space-y-1.5">
          <CheckRow
            label="Elektronische Vorprüfung"
            hint="Wird bei gültigem ZUGFeRD/XRechnung-Format automatisch gesetzt — hier auch manuell änderbar"
            at={invoice.checkElectronicAt} by={invoice.checkElectronicBy}
            busy={busy} onToggle={(v) => toggleCheck('checkElectronic', v)}
          />
          <CheckRow
            label="Formal richtig"
            hint="Rechnung enthält alle formal nötigen Pflichtangaben"
            at={invoice.checkFormalAt} by={invoice.checkFormalBy}
            busy={busy} onToggle={(v) => toggleCheck('checkFormal', v)}
          />
        </div>
        <p className="mt-2 text-[11px] text-gray-400">
          „Sachlich richtig" und „An Buchhaltung übergeben" werden in der Rechnungsliste abgehakt
          (Buchhaltungs-Schritte, nicht Teil der Erfassung).
        </p>
      </div>
      <AttachmentsPanel invoiceId={invoice.id} encryptionEnabled={encryptionEnabled} />
      <InvoiceNotesPanel invoiceId={invoice.id} colleagues={colleagues} />
      {msg && (
        <p className={`text-sm ${msg === 'Gespeichert.' ? 'text-[var(--accent)]' : 'text-[var(--danger)]'}`}>{msg}</p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy} title="Änderungen speichern">
          {busy ? 'Speichere …' : 'Speichern'}
        </button>
        <button type="button" className="btn-secondary" onClick={() => router.push('/invoices')} title="Ohne Speichern zurück zur Liste">
          Zurück
        </button>
        <button type="button" className="btn-danger ml-auto" onClick={remove} disabled={busy}
          title="Rechnung als gelöscht markieren — Beleg bleibt erhalten, im Papierkorb wiederherstellbar">
          Löschen
        </button>
      </div>
    </form>
  )
}

function CheckRow({
  label, hint, at, by, busy, onToggle,
}: {
  label: string; hint?: string; at: string | null; by: string | null; busy: boolean; onToggle: (v: boolean) => void
}) {
  const checked = at !== null
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-gray-700" title={hint}>
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
  label, value, onChange, type = 'text', required, warn, locked, lockReason,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; warn?: boolean
  locked?: boolean; lockReason?: string
}) {
  return (
    <div>
      <label className="dp-label">
        {label}
        {warn && <span className="ml-1 text-[var(--warn-strong)]" title="KI ist sich hier unsicher — bitte prüfen">⚠</span>}
        {locked && <span className="ml-1 text-gray-400" title={lockReason}>🔒</span>}
      </label>
      {locked ? (
        <p className="dp-input mt-1 flex items-center bg-[var(--surface-muted)] text-gray-500" title={lockReason}>
          {value || '—'}
        </p>
      ) : (
        <input
          className={`dp-input mt-1 ${warn ? 'border-[var(--warn-border)] bg-[var(--warn-bg)]' : ''}`}
          type={type} value={value} required={required}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}
