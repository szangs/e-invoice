'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { FileLink } from '@/components/crypto/FileLink'
import { DEK_UNLOCKED_EVENT, notifyDekUnlocked, useDecryptedContent } from '@/components/crypto/useDecryptedContent'
import { decryptBytes, encryptJson } from '@/lib/clientCrypto'
import { EINVOICE_FORMATS } from '@/lib/docFormat'
import { getCachedDek, unlockWithPassphrase } from '@/lib/keyStore'
import { formatAmount, type InvoiceDTO, type InvoiceLineItem } from '@/lib/invoices'
import { BasketMoveSelect } from '../BasketMoveSelect'
import { InvoiceNotesPanel } from './InvoiceNotesPanel'
import { RequestCorrectionForm } from './RequestCorrectionForm'

const AI_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp']
const CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP']

// Felder, die beim automatischen Mail-Eingang per KI vorbelegt werden (siehe
// lib/mailin.ts) und deshalb vor dem ersten Verschieben von einem Menschen
// durchgegangen werden müssen — Reihenfolge = Tab-Reihenfolge im Formular.
type ReviewField = 'vendor' | 'invoiceNumber' | 'invoiceDate' | 'dueDate' | 'amountNet' | 'amountTax' | 'amountGross'
const REVIEW_FIELD_ORDER: ReviewField[] = ['vendor', 'invoiceNumber', 'invoiceDate', 'dueDate', 'amountNet', 'amountTax', 'amountGross']
type ReviewStatus = 'pending' | 'confirmed' | 'flagged'

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

// Bearbeitungskette (Stefan 2026-08-25): Herkunft der Rechnung lesbar
// beschriften — "wurde über E-Invoice/E-Mail-Eingang verarbeitet" statt nur
// des internen Kürzels aus Invoice.source.
const SOURCE_LABELS: Record<string, string> = {
  EMAIL: 'E-Mail-Eingang (E-Invoice, automatisch verarbeitet)',
  UPLOAD: 'Manueller Upload',
  SCAN: 'Scan (Kamera)',
  EXTENSION: 'Rechnungs-Catcher (Browser-Erweiterung)',
  RESTORE: 'Wiederhergestellt aus Sicherung',
}

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
  costCentersEnabled,
  colleagues,
  locked,
  validationMissing,
  suggestedVendorEmail,
}: {
  invoice: InvoiceDTO
  baskets: { id: string; name: string }[]
  pendingApproval: { targetName: string; approvedBy: string[]; needed: number } | null
  encryptionEnabled: boolean
  costCentersEnabled: boolean
  colleagues: { id: string; name: string }[]
  /** Beleg-Eingang fällt in ein abgeschlossenes Audit-Jahr (§18, Stefan 2026-08-25) — vollständig schreibgeschützt (serverseitig ebenfalls erzwungen, siehe api/invoices/[id]/route.ts). */
  locked: boolean
  /** Fehlende Pflichtangaben (EN 16931/§14 UStG) — null wenn keine E-Rechnung oder vollständig, siehe lib/erechnung.ts validateData. */
  validationMissing: string[] | null
  /** Aus dem Notiztext vorgeschlagene Absenderadresse für "Korrektur anfordern" — nur ein Vorschlag, siehe page.tsx. */
  suggestedVendorEmail: string | null
}) {
  const router = useRouter()
  const [f, setF] = useState({
    vendor: invoice.vendor,
    invoiceNumber: invoice.invoiceNumber ?? '',
    invoiceDate: invoice.invoiceDate ?? '',
    dueDate: invoice.dueDate ?? '',
    discountDueDate: invoice.discountDueDate ?? '',
    discountPercent: toInput(invoice.discountPercent),
    amountNet: toInput(invoice.amountNet),
    amountTax: toInput(invoice.amountTax),
    amountGross: toInput(invoice.amountGross),
    currency: invoice.currency,
    status: invoice.status as string,
    tags: invoice.tags ?? '',
    notes: invoice.notes ?? '',
    directDebitByVendor: invoice.directDebitByVendor,
    costCenterCode: invoice.costCenterCode ?? '',
    costCarrierCode: invoice.costCarrierCode ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  // Positionszeilen aus der KI-Erkennung (Stefan 2026-08-25) — nur bei
  // nackten PDFs/Scans, siehe Invoice.lineItems. Bewusst nur Anzeige, keine
  // Bearbeitung — die App bietet nirgends eine Zeilen-Bearbeitung an, weder
  // hier noch bei ZUGFeRD/XRechnung (dort sind es Original-XML-Daten).
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>(invoice.lineItems ?? [])

  // Kostenstellen/Kostenträger (Stefan 2026-07-09, #114): Listen nur laden,
  // wenn der Mandant die Funktion eingeschaltet hat — Workflow-Feld, immer
  // Klartext, unabhängig von Verschlüsselung/E-Rechnungs-Sperre.
  const [costCenters, setCostCenters] = useState<{ id: string; code: string; name: string }[]>([])
  const [costCarriers, setCostCarriers] = useState<{ id: string; code: string; name: string }[]>([])
  useEffect(() => {
    if (!costCentersEnabled) return
    fetch('/api/admin/cost-codes?kind=KOSTENSTELLE').then((r) => r.json()).then((d) => setCostCenters(d.codes ?? [])).catch(() => undefined)
    fetch('/api/admin/cost-codes?kind=KOSTENTRAEGER').then((r) => r.json()).then((d) => setCostCarriers(d.codes ?? [])).catch(() => undefined)
  }, [costCentersEnabled])

  // Inhalts-Verschlüsselung (Stefan 2026-07-09): vendor/invoiceNumber/
  // amount*/tags/notes oben sind bei contentEnc nur Platzhalter/leer — hier
  // client-seitig entschlüsseln und ins Formular übernehmen, sobald der
  // Schlüssel verfügbar ist (Passphrase-Prompt unten, falls noch gesperrt).
  const { data: decryptedContent } = useDecryptedContent(invoice.contentEnc)
  useEffect(() => {
    if (!decryptedContent) return
    setF((p) => ({
      ...p,
      vendor: decryptedContent.vendor ?? p.vendor,
      invoiceNumber: decryptedContent.invoiceNumber ?? '',
      amountNet: decryptedContent.amountNet ?? '',
      amountTax: decryptedContent.amountTax ?? '',
      amountGross: decryptedContent.amountGross ?? '',
      currency: decryptedContent.currency ?? p.currency,
      tags: decryptedContent.tags ?? '',
      notes: decryptedContent.notes ?? '',
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decryptedContent])
  // Auch relevant, wenn DIESE Rechnung noch gar kein contentEnc hat (z. B.
  // alte, vor der Verschlüsselung angelegte Rechnung) — beim Speichern wird
  // sie dann automatisch mitverschlüsselt und braucht dafür ebenfalls den
  // Schlüssel, auch ohne dass hier etwas zu entschlüsseln war.
  const [dekAvailable, setDekAvailable] = useState(false)
  useEffect(() => {
    let stop = false
    function check() {
      getCachedDek().then((dek) => { if (!stop) setDekAvailable(Boolean(dek)) })
    }
    check()
    window.addEventListener(DEK_UNLOCKED_EVENT, check)
    return () => {
      stop = true
      window.removeEventListener(DEK_UNLOCKED_EVENT, check)
    }
  }, [])
  const [unlockPass, setUnlockPass] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [unlockBusy, setUnlockBusy] = useState(false)
  async function unlockContent(e: React.SyntheticEvent) {
    e.preventDefault()
    setUnlockBusy(true)
    setUnlockError('')
    try {
      await unlockWithPassphrase(unlockPass)
      setUnlockPass('')
      notifyDekUnlocked()
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : 'Passphrase falsch.')
    } finally {
      setUnlockBusy(false)
    }
  }
  // KI-Erkennung anbieten bei: Fotos/Scans (Bild) ODER "nackter" PDF (kein
  // eingebettetes E-Rechnungs-XML) — NICHT bei ZUGFeRD/XRechnung, die haben
  // die Daten schon strukturiert. Nackte PDFs werden serverseitig vor der
  // KI-Anfrage gerastert (lib/pdfRaster.ts).
  const isEInvoice = (EINVOICE_FORMATS as string[]).includes(invoice.docFormat ?? '')
  // Inhalts-Verschlüsselung nur bei Nicht-E-Rechnungen (Stefan 2026-07-09) —
  // ZUGFeRD/XRechnung lassen sich strukturell gar nicht verschlüsselt hochladen
  // (der Server kann das XML sonst nie erkennen), die GoBD-gesperrten Felder
  // bleiben also immer im Klartext, wie bisher.
  const shouldEncryptContent = encryptionEnabled && !isEInvoice
  const isImage = AI_IMAGE_MIMES.includes(invoice.mimeType ?? '')
  const isPlainPdf = invoice.mimeType === 'application/pdf' && !isEInvoice
  // Verschlüsselte Belege sind jetzt eingeschlossen (Stefan 2026-07-09) — der
  // Beleg wird dafür client-seitig entschlüsselt und nur transient an den
  // KI-Anbieter weitergereicht (siehe fillWithAi unten).
  const canUseAi = invoice.hasFile && (isImage || isPlainPdf)
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
  const [aiFlags, setAiFlags] = useState<string[]>(() => (invoice.aiUncertainFields ?? '').split(',').filter(Boolean))
  const [usedAi, setUsedAi] = useState(false)
  // Bestätigungs-Fluss für automatisch (ohne Browser-Sitzung) per KI erkannte
  // Werte, z. B. beim Mail-Eingang (lib/mailin.ts) — solange aiConfirmedAt
  // leer ist, muss jedes Feld einmal per Tab (übernehmen) oder Shift+Tab
  // (als falsch markieren) durchlaufen werden, bevor die Rechnung gespeichert
  // werden kann UND verschiebbar wird (serverseitig erzwungen, siehe
  // lib/baskets.ts requestMove).
  const needsAiConfirm = invoice.aiAssisted && !invoice.aiConfirmedAt
  const [reviewStatus, setReviewStatus] = useState<Record<ReviewField, ReviewStatus>>(
    () => Object.fromEntries(REVIEW_FIELD_ORDER.map((k) => [k, 'pending'])) as Record<ReviewField, ReviewStatus>,
  )
  const activeReviewFields = REVIEW_FIELD_ORDER.filter((k) => k !== 'dueDate' || !invoice.directDebitByVendor)
  const reviewedCount = activeReviewFields.filter((k) => reviewStatus[k] !== 'pending').length
  const allReviewed = needsAiConfirm && reviewedCount === activeReviewFields.length
  function reviewKeyDown(field: ReviewField) {
    return (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Tab' || !needsAiConfirm) return
      setReviewStatus((p) => ({ ...p, [field]: e.shiftKey ? 'flagged' : 'confirmed' }))
    }
  }
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
      let res: Response
      if (invoice.encrypted) {
        // Beleg ist nur als Chiffrat gespeichert — der Server kann ihn nicht
        // lesen. Hier selbst entschlüsseln (wie FileLink.tsx) und die
        // Klartext-Bytes NUR für diesen einen KI-Aufruf mitschicken.
        const dek = await getCachedDek()
        if (!dek) {
          setAiError('Bitte zuerst oben die Passphrase eingeben, um den Beleg zu entschlüsseln.')
          return
        }
        const fileRes = await fetch(`/api/invoices/${invoice.id}/file`)
        if (!fileRes.ok) {
          setAiError('Beleg konnte nicht geladen werden.')
          return
        }
        const plain = await decryptBytes(dek, await fileRes.arrayBuffer())
        const fd = new FormData()
        fd.append('file', new Blob([plain]), invoice.originalName ?? 'beleg')
        res = await fetch(`/api/invoices/${invoice.id}/ai-extract`, { method: 'POST', body: fd })
      } else {
        res = await fetch(`/api/invoices/${invoice.id}/ai-extract`, { method: 'POST' })
      }
      const data = await res.json()
      if (!res.ok) {
        setAiError(data.error ?? 'KI-Erkennung fehlgeschlagen.')
        return
      }
      const d = data.data as {
        vendor: string | null; invoiceNumber: string | null; invoiceDate: string | null
        dueDate: string | null; discountDueDate: string | null; discountPercent: number | null
        amountNet: number | null; amountTax: number | null
        amountGross: number | null; currency: string | null; tags: string | null
        directDebitByVendor: boolean | null
        uncertainFields: string[]; warnings: string[]
        lines: InvoiceLineItem[]
      }
      setF((p) => ({
        ...p,
        vendor: d.vendor ?? p.vendor,
        invoiceNumber: d.invoiceNumber ?? p.invoiceNumber,
        invoiceDate: d.invoiceDate ?? p.invoiceDate,
        dueDate: d.dueDate ?? p.dueDate,
        discountDueDate: d.discountDueDate ?? p.discountDueDate,
        discountPercent: d.discountPercent !== null ? toInput(d.discountPercent) : p.discountPercent,
        amountNet: d.amountNet !== null ? toInput(d.amountNet) : p.amountNet,
        amountTax: d.amountTax !== null ? toInput(d.amountTax) : p.amountTax,
        amountGross: d.amountGross !== null ? toInput(d.amountGross) : p.amountGross,
        currency: d.currency && CURRENCIES.includes(d.currency) ? d.currency : p.currency,
        tags: d.tags ?? p.tags,
        directDebitByVendor: d.directDebitByVendor ?? p.directDebitByVendor,
      }))
      setAiFlags(d.uncertainFields ?? [])
      setAiWarnings(d.warnings ?? [])
      if (d.lines && d.lines.length > 0) setLineItems(d.lines)
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
    const base = {
      invoiceDate: f.invoiceDate || null,
      dueDate: f.dueDate || null,
      discountDueDate: f.discountDueDate || null,
      discountPercent: toNumber(f.discountPercent),
      status: f.status,
      directDebitByVendor: f.directDebitByVendor,
      ...(costCentersEnabled ? { costCenterCode: f.costCenterCode || null, costCarrierCode: f.costCarrierCode || null } : {}),
      ...(usedAi ? { aiAssisted: true } : {}),
      ...(allReviewed ? { confirmAi: true as const } : {}),
      // Positionszeilen sind Workflow-Metadaten wie Kostenstelle/-träger, keine
      // GoBD-gesperrten Rechnungsdaten — deshalb immer im Klartext, auch bei
      // aktiver Inhalts-Verschlüsselung (analog costCenterCode oben).
      lineItems: lineItems.length > 0 ? lineItems : null,
    }
    let body: Record<string, unknown>
    if (shouldEncryptContent) {
      // Inhaltsfelder neu verschlüsseln statt im Klartext zu senden — gilt
      // auch für Rechnungen, die vorher noch unverschlüsselt waren (wandern
      // beim nächsten Speichern automatisch in die Verschlüsselung).
      let dek = await getCachedDek()
      if (!dek) {
        try {
          dek = await unlockWithPassphrase(unlockPass)
        } catch (err) {
          setBusy(false)
          setMsg(err instanceof Error ? err.message : 'Passphrase falsch — bitte oben entsperren.')
          return
        }
      }
      const contentEnc = await encryptJson(dek, {
        vendor: f.vendor, invoiceNumber: f.invoiceNumber, amountNet: f.amountNet,
        amountTax: f.amountTax, amountGross: f.amountGross, currency: f.currency,
        tags: f.tags, notes: f.notes,
      })
      body = { ...base, contentEnc }
    } else {
      body = {
        ...base,
        vendor: f.vendor,
        invoiceNumber: f.invoiceNumber || null,
        amountNet: toNumber(f.amountNet),
        amountTax: toNumber(f.amountTax),
        amountGross: toNumber(f.amountGross),
        currency: f.currency,
        tags: f.tags || null,
        notes: f.notes || null,
      }
    }
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

  // Layout (Stefan 2026-07-09, #113): statt eines einzigen, langen Formulars
  // jetzt klar abgegrenzte Karten je Themenblock (Meta/Korb, Rechnungsdaten,
  // Notizen, Prüfung, Anhänge, Nachrichten) — bessere Übersicht, gleiche Logik.
  return (
    <form onSubmit={save} className="space-y-4">
      {locked && (
        <div className="dp-card border-2 border-gray-300 bg-[var(--surface-muted)] text-sm text-gray-600">
          🔒 Diese Rechnung gehört zum abgeschlossenen Prüfungszeitraum {new Date(invoice.createdAt).getFullYear()}
          {' '}und ist schreibgeschützt — keine Änderungen, kein Verschieben, kein Löschen mehr möglich.
        </div>
      )}
      <fieldset disabled={locked} className="contents border-0 p-0">
      <div className="dp-card space-y-2.5">
        {invoice.docId && (
          <p className="font-mono text-[11px] text-gray-400" title="Eindeutige Dokumenten-ID (GoBD-Referenzierung)">
            {invoice.docId}
          </p>
        )}
        {(shouldEncryptContent || invoice.contentEnc) && !dekAvailable && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--accent-soft)] bg-[var(--accent-bg)] px-3 py-2">
            <span className="text-[11px] font-medium text-[var(--accent)]">
              🔒 Verschlüsselte Inhalte — Passphrase eingeben, um Lieferant, Beträge etc. zu sehen und zu bearbeiten.
            </span>
            <input type="password" className="dp-input !w-auto flex-1" value={unlockPass} autoFocus
              onChange={(e) => setUnlockPass(e.target.value)} placeholder="Passphrase" />
            <button type="button" className="btn-secondary" onClick={unlockContent} disabled={unlockBusy || !unlockPass}
              title="Verschlüsselte Inhalte mit dieser Passphrase im Browser entschlüsseln">
              {unlockBusy ? 'Entsperre …' : 'Entsperren'}
            </button>
            {unlockError && <span className="w-full text-xs text-[var(--danger)]">{unlockError}</span>}
          </div>
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
              disabled={needsAiConfirm}
              disabledReason="Von der KI erkannte Werte müssen erst geprüft und bestätigt werden (siehe oben)."
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
            <span className="ml-1 text-[11px] text-gray-400">(Vorschau rechts)</span>
          </p>
        )}
      </div>

      <div className="dp-card space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Rechnungsdaten</h3>
        {canUseAi && aiAvailable && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2">
            <button type="button" className="btn-secondary" onClick={fillWithAi} disabled={aiBusy}
              title="Beleg per KI auslesen und Felder unten vorschlagen — Ergebnis bitte immer gegenprüfen">
              {aiBusy ? 'KI liest die Rechnung …' : '✨ Mit KI erkennen'}
            </button>
            <p className="text-[11px] text-gray-500">
              Liest den Beleg nachträglich per KI aus und befüllt die Felder unten (auch
              Verschlagwortung) — bitte prüfen und speichern.
              {invoice.encrypted && (
                <span className="block text-[var(--warn-strong)]">
                  ⚠ Der Beleg wird für diese Erkennung entschlüsselt und an den externen KI-Anbieter
                  gesendet — dieser Schritt ist eine bewusste Ausnahme vom Zero-Knowledge-Grundsatz,
                  unser Server speichert den Klartext dabei nicht.
                </span>
              )}
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
        {needsAiConfirm && (
          <div className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2">
            <p className="text-xs font-semibold text-[var(--warn-strong)]">
              🤖 Diese Werte wurden beim Mail-Eingang automatisch per KI erkannt und noch NICHT bestätigt
              ({reviewedCount}/{activeReviewFields.length} Feld{activeReviewFields.length === 1 ? '' : 'er'} geprüft).
              Die Rechnung lässt sich erst danach in einen anderen Korb verschieben.
            </p>
            <p className="mt-1 text-[11px] text-[var(--warn-strong)]">
              Mit <kbd className="rounded border px-1 font-mono">Tab</kbd> durch die Felder gehen (übernimmt den
              vorgeschlagenen Wert), bei einem falschen Wert stattdessen{' '}
              <kbd className="rounded border px-1 font-mono">Shift+Tab</kbd> drücken, um ihn zu markieren, und den
              richtigen Wert eintragen. Danach unten „Speichern".
            </p>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lieferant *" value={f.vendor} onChange={(v) => set('vendor', v)} required
            warn={aiFlags.includes('vendor')} locked={isEInvoice} lockReason={LOCK_REASON}
            onKeyDown={reviewKeyDown('vendor')} reviewStatus={needsAiConfirm ? reviewStatus.vendor : undefined} />
          <Field label="Rechnungsnummer" value={f.invoiceNumber} onChange={(v) => set('invoiceNumber', v)}
            warn={aiFlags.includes('invoiceNumber')} locked={isEInvoice} lockReason={LOCK_REASON}
            onKeyDown={reviewKeyDown('invoiceNumber')} reviewStatus={needsAiConfirm ? reviewStatus.invoiceNumber : undefined} />
          <Field label="Rechnungsdatum" type="date" value={f.invoiceDate} onChange={(v) => set('invoiceDate', v)}
            warn={aiFlags.includes('invoiceDate')} locked={isEInvoice} lockReason={LOCK_REASON}
            onKeyDown={reviewKeyDown('invoiceDate')} reviewStatus={needsAiConfirm ? reviewStatus.invoiceDate : undefined} />
          {f.directDebitByVendor ? (
            <div>
              <label className="dp-label">Fälligkeit</label>
              <p className="dp-input mt-1 flex items-center text-gray-500" title="Lieferant bucht per Lastschrift/Abbuchung selbst ab">
                wird abgebucht
              </p>
            </div>
          ) : (
            <Field label="Fälligkeit" type="date" value={f.dueDate} onChange={(v) => set('dueDate', v)}
              warn={aiFlags.includes('dueDate')} locked={isEInvoice} lockReason={LOCK_REASON}
              onKeyDown={reviewKeyDown('dueDate')} reviewStatus={needsAiConfirm ? reviewStatus.dueDate : undefined} />
          )}
          {/* Skonto (Stefan 2026-08-25): eigene Felder, getrennt von der
              Fälligkeit oben — die ist IMMER das Zahlungsziel netto, Skonto
              ist die kürzere Frist mit Rabatt bei vorzeitiger Zahlung. Nur
              sichtbar, wenn erkannt/eingetragen ODER frei editierbar (keine
              E-Rechnung), sonst unnötig leeres, gesperrtes Feldpaar. */}
          {(f.discountDueDate || f.discountPercent || !isEInvoice) && (
            <>
              <Field label="Skonto-Frist" type="date" value={f.discountDueDate} onChange={(v) => set('discountDueDate', v)}
                locked={isEInvoice} lockReason={LOCK_REASON} />
              <Field label="Skonto (%)" value={f.discountPercent} onChange={(v) => set('discountPercent', v)}
                locked={isEInvoice} lockReason={LOCK_REASON} />
            </>
          )}
          <Field label="Netto" value={f.amountNet} onChange={(v) => set('amountNet', v)}
            warn={aiFlags.includes('amountNet')} locked={isEInvoice} lockReason={LOCK_REASON}
            onKeyDown={reviewKeyDown('amountNet')} reviewStatus={needsAiConfirm ? reviewStatus.amountNet : undefined} />
          <Field label="Steuer" value={f.amountTax} onChange={(v) => set('amountTax', v)}
            warn={aiFlags.includes('amountTax')} locked={isEInvoice} lockReason={LOCK_REASON}
            onKeyDown={reviewKeyDown('amountTax')} reviewStatus={needsAiConfirm ? reviewStatus.amountTax : undefined} />
          <Field label="Brutto" value={f.amountGross} onChange={(v) => set('amountGross', v)}
            warn={aiFlags.includes('amountGross')} locked={isEInvoice} lockReason={LOCK_REASON}
            onKeyDown={reviewKeyDown('amountGross')} reviewStatus={needsAiConfirm ? reviewStatus.amountGross : undefined} />
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
        {/* Positionszeilen (Stefan 2026-08-25): nur bei nackten PDFs/Scans — bei
            ZUGFeRD/XRechnung zeigt ERechnungView oben bereits die Positionen
            live aus dem Original-XML, keine doppelte Tabelle nötig. Reine
            Anzeige, nicht editierbar — von der KI gelesen, nicht von Hand erfasst. */}
        {!isEInvoice && lineItems.length > 0 && (
          <div>
            <p className="dp-label mb-1">Positionszeilen ({lineItems.length}) — von der KI gelesen, bitte gegenprüfen</p>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--line)]">
              <table className="w-full">
                <thead className="sticky top-0 bg-[var(--surface)]">
                  <tr className="dp-tr">
                    <th className="dp-th">Bezeichnung</th>
                    <th className="dp-th">Menge</th>
                    <th className="dp-th text-right">Einzelpreis</th>
                    <th className="dp-th text-right">Betrag</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((l, i) => (
                    <tr key={i} className="dp-tr">
                      <td className="dp-td">{l.name}</td>
                      <td className="dp-td text-xs">{l.qty ?? '—'}</td>
                      <td className="dp-td text-right text-xs">{l.unitPrice !== null ? formatAmount(l.unitPrice, f.currency) : '—'}</td>
                      <td className="dp-td text-right">{l.total !== null ? formatAmount(l.total, f.currency) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
        {costCentersEnabled && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="dp-label" title="Buchungsdimension — Liste in den Mandanten-Einstellungen unter DATEV-Export pflegbar">
                Kostenstelle
              </label>
              <select className="dp-input mt-1" value={f.costCenterCode}
                onChange={(e) => setF((p) => ({ ...p, costCenterCode: e.target.value }))}>
                <option value="">— keine —</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.code}>{c.code} — {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="dp-label" title="Buchungsdimension — Liste in den Mandanten-Einstellungen unter DATEV-Export pflegbar">
                Kostenträger
              </label>
              <select className="dp-input mt-1" value={f.costCarrierCode}
                onChange={(e) => setF((p) => ({ ...p, costCarrierCode: e.target.value }))}>
                <option value="">— keiner —</option>
                {costCarriers.map((c) => (
                  <option key={c.id} value={c.code}>{c.code} — {c.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="dp-card">
        <label className="dp-label" title="Interne Notiz, Kontierung oder ergänzende Information — nicht Teil der Rechnung selbst, immer frei editierbar">
          Notizen (z. B. Kontierung, interne Vermerke)
        </label>
        <textarea className="dp-input mt-1" rows={3} value={f.notes}
          title="Interne Notiz, Kontierung oder ergänzende Information — nicht Teil der Rechnung selbst, immer frei editierbar"
          onChange={(e) => set('notes', e.target.value)} />
      </div>

      <div className="dp-card">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Bearbeitungskette</h3>
        <p className="mb-2 flex items-center gap-2 text-sm text-gray-700">
          <span className="text-gray-400">📥</span>
          Eingang: {SOURCE_LABELS[invoice.source] ?? invoice.source}
          <span className="text-[11px] text-gray-400">am {new Date(invoice.createdAt).toLocaleString('de-DE')}</span>
        </p>
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
          {/* Sachlich richtig / An Buchhaltung übergeben werden weiterhin nur in
              der Rechnungsliste abgehakt (Korb-Recht APPROVE/HANDOVER, dort per
              CheckBadges.tsx togglebar) — hier nur lesend, damit die komplette
              Bearbeitungskette (wer hat wann was freigegeben) an einer Stelle
              sichtbar ist, ohne die Rechte-Logik dieser Seite zu duplizieren. */}
          <CheckRow
            label="Sachlich richtig"
            hint="Vier-Augen-Freigabe — togglebar in der Rechnungsliste (Korb-Recht „Sachlich freigeben“)"
            at={invoice.checkSubstantiveAt} by={invoice.checkSubstantiveBy}
            readOnly
          />
          <CheckRow
            label="An Buchhaltung übergeben"
            hint="Togglebar in der Rechnungsliste, nur im Übergabekorb (Korb-Recht HANDOVER)"
            at={invoice.checkAccountingAt} by={invoice.checkAccountingBy}
            readOnly
          />
        </div>
        {/* "Korrektur anfordern" (Stefan 2026-08-25): Mensch löst den Versand
            bewusst aus, kein Automatismus — siehe RequestCorrectionForm.tsx. */}
        <div className="mt-3 border-t border-[var(--line)] pt-3">
          <RequestCorrectionForm
            invoiceId={invoice.id}
            vendor={f.vendor}
            invoiceNumber={f.invoiceNumber || null}
            missing={validationMissing}
            suggestedEmail={suggestedVendorEmail}
            locked={locked}
          />
        </div>
      </div>

      <InvoiceNotesPanel invoiceId={invoice.id} colleagues={colleagues} />

      <div className="dp-card flex flex-wrap items-center gap-2">
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
        {msg && (
          <p className={`w-full text-sm ${msg === 'Gespeichert.' ? 'text-[var(--accent)]' : 'text-[var(--danger)]'}`}>{msg}</p>
        )}
      </div>
      </fieldset>
    </form>
  )
}

function CheckRow({
  label, hint, at, by, busy, onToggle, readOnly,
}: {
  label: string; hint?: string; at: string | null; by: string | null
  busy?: boolean; onToggle?: (v: boolean) => void; readOnly?: boolean
}) {
  const checked = at !== null
  // Stefan 2026-08-25: bei Nicht-E-Rechnungen (nackte PDF, Scan, aus
  // Dokumenten-Text) ist "Elektronische Vorprüfung" gar nicht anwendbar —
  // System markiert das automatisch (siehe lib/erechnung.ts
  // autoElectronicCheck), erkennbar am "System (entfällt"-Präfix. Statt
  // eines togglebaren Häkchens (das nichts zu prüfen hätte) ein neutraler,
  // nicht interaktiver Hinweis.
  if (checked && by?.startsWith('System (entfällt')) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-gray-400" title={`${hint ?? ''} — kein E-Rechnungs-Format, daher nichts maschinell zu prüfen.`}>
        <span className="text-gray-300">–</span>
        {label}
        <span className="text-[11px] text-gray-400">entfällt (kein E-Rechnungs-Format)</span>
      </p>
    )
  }
  // Nur-Lese-Darstellung (Stefan 2026-08-25): "Sachlich richtig"/"An
  // Buchhaltung übergeben" sind hier nicht togglebar (Rechte-Prüfung bleibt
  // in der Liste, siehe CheckBadges.tsx) — trotzdem als Teil der
  // Bearbeitungskette sichtbar, wer wann freigegeben hat bzw. dass es noch offen ist.
  if (readOnly) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-gray-700" title={hint}>
        <span className={checked ? 'text-green-600' : 'text-gray-300'}>{checked ? '✓' : '○'}</span>
        {label}
        <span className="text-[11px] text-gray-400">
          {checked ? `— ${by} am ${new Date(at as string).toLocaleString('de-DE')}` : '— noch offen'}
        </span>
      </p>
    )
  }
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-gray-700" title={hint}>
      <input type="checkbox" checked={checked} disabled={busy} className="accent-green-600"
        onChange={(e) => onToggle?.(e.target.checked)} />
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

const REVIEW_STATUS_ICON: Record<ReviewStatus, { icon: string; title: string; className: string }> = {
  pending: { icon: '⏳', title: 'Noch zu prüfen — Tab zum Übernehmen, Shift+Tab wenn der Wert falsch ist', className: 'text-[var(--warn-strong)]' },
  confirmed: { icon: '✓', title: 'Bestätigt', className: 'text-[var(--accent)]' },
  flagged: { icon: '✗', title: 'Als falsch markiert — bitte Wert korrigieren', className: 'text-[var(--danger)]' },
}

function Field({
  label, value, onChange, type = 'text', required, warn, locked, lockReason, onKeyDown, reviewStatus,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; warn?: boolean
  locked?: boolean; lockReason?: string; onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>; reviewStatus?: ReviewStatus
}) {
  const rs = reviewStatus ? REVIEW_STATUS_ICON[reviewStatus] : null
  return (
    <div>
      <label className="dp-label">
        {label}
        {warn && <span className="ml-1 text-[var(--warn-strong)]" title="KI ist sich hier unsicher — bitte prüfen">⚠</span>}
        {locked && <span className="ml-1 text-gray-400" title={lockReason}>🔒</span>}
        {rs && <span className={`ml-1 ${rs.className}`} title={rs.title}>{rs.icon}</span>}
      </label>
      {locked ? (
        <p className="dp-input mt-1 flex items-center bg-[var(--surface-muted)] text-gray-500" title={lockReason}>
          {value || '—'}
        </p>
      ) : (
        <input
          className={`dp-input mt-1 ${warn || reviewStatus === 'flagged' ? 'border-[var(--warn-border)] bg-[var(--warn-bg)]' : ''}`}
          type={type} value={value} required={required}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
      )}
    </div>
  )
}
