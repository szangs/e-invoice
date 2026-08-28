'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { DEK_UNLOCKED_EVENT, notifyDekUnlocked, useDecryptedContent } from '@/components/crypto/useDecryptedContent'
import { computeSearchTokens, decryptBytes, deriveSearchKey, encryptJson } from '@/lib/clientCrypto'
import { EINVOICE_FORMATS, FORMAT_LABELS } from '@/lib/docFormat'
import { TAX_REGION_LABELS } from '@/lib/erechnung'
import type { DocFormat, ParsedInvoiceData, TaxRegion, Validation } from '@/lib/erechnung'
import { getCachedDek, getCachedDekRaw, unlockWithPassphrase } from '@/lib/keyStore'
import type { InvoiceDTO, InvoiceLineItem } from '@/lib/invoices'
import { BasketMoveButton } from './BasketMoveButton'
import { InvoiceHandoffButton } from './InvoiceHandoffButton'
import { InvoiceNoteButton } from './InvoiceNoteButton'
import { ERechnungView, type EditBundle } from './ERechnungView'
import { RequestCorrectionForm } from './RequestCorrectionForm'

const AI_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp']
const CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP']

// Felder, die beim automatischen Mail-Eingang per KI vorbelegt werden (siehe
// lib/mailin.ts) und deshalb vor dem ersten Verschieben von einem Menschen
// durchgegangen werden müssen — Reihenfolge = Tab-Reihenfolge im Formular.
type ReviewField = 'vendor' | 'invoiceNumber' | 'invoiceDate' | 'dueDate' | 'amountNet' | 'amountTax' | 'amountGross'
const REVIEW_FIELD_ORDER: ReviewField[] = ['vendor', 'invoiceNumber', 'invoiceDate', 'dueDate', 'amountNet', 'amountTax', 'amountGross']
type ReviewStatus = 'pending' | 'confirmed' | 'flagged'

// Pflichtangaben-Schnellausfüllung (Stefan 2026-08-27, "wenn er den
// Lieferant schon kennt") — eigener Hinweistext statt der KI-Vermutungs-
// Formulierung, siehe vendorFlags weiter unten.
const VENDOR_SUGGESTION_HINT = 'Aus einer früheren Rechnung dieses Lieferanten übernommen — bitte prüfen'

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
  // Immer 2 Nachkommastellen (Stefan 2026-08-25, Bugfix) — vorher zeigte
  // String(n) z. B. bei 1200 nur "1200" statt "1200,00" und bei 1200.5 nur
  // "1200,5" statt "1200,50", weil JavaScript nachgestellte Nullen nicht
  // in der Zahl selbst speichert.
  return n === null ? '' : n.toFixed(2).replace('.', ',')
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
  costCenterEnabled,
  costCarrierEnabled,
  colleagues,
  locked,
  validationMissing,
  suggestedVendorEmail,
  supersededByInvoiceId,
  activeHandoff,
  format,
  erechnungData,
  validation,
  effectiveRegion,
  buyerNameCheck,
  canApprove,
  vendorSuggestion,
}: {
  invoice: InvoiceDTO
  baskets: { id: string; name: string }[]
  pendingApproval: { targetName: string; approvedBy: string[]; needed: number } | null
  encryptionEnabled: boolean
  costCenterEnabled: boolean
  costCarrierEnabled: boolean
  colleagues: { id: string; name: string }[]
  /** Beleg-Eingang fällt in ein abgeschlossenes Audit-Jahr (§18, Stefan 2026-08-25) ODER wurde durch eine neuere Version ersetzt — vollständig schreibgeschützt (serverseitig ebenfalls erzwungen, siehe api/invoices/[id]/route.ts). */
  locked: boolean
  /** Fehlende Pflichtangaben (EN 16931/§14 UStG) — null wenn keine E-Rechnung oder vollständig, siehe lib/erechnung.ts validateData. */
  validationMissing: string[] | null
  /** Aus dem Notiztext vorgeschlagene Absenderadresse für "Korrektur anfordern" — nur ein Vorschlag, siehe page.tsx. */
  suggestedVendorEmail: string | null
  /** Rechnungsversionierung (Stefan 2026-08-25) — gesetzt, wenn diese Rechnung eine ältere, überholte Version ist; unterscheidet die Banner-Meldung von der Perioden-Sperre. */
  supersededByInvoiceId: string | null
  /** "Zur Prüfung weitergeben" (Stefan 2026-08-27) — aktiver Handoff dieser Rechnung, falls vorhanden, siehe lib/invoiceHandoff.ts. */
  activeHandoff: {
    noteId: string
    toUserId: string
    toUserName: string
    authorName: string
    subject: string | null
    text: string
    createdAt: string
    isRecipient: boolean
    // Stefan 2026-08-27, Fehlerbericht "es fehlt eine Option, sie
    // zurückzuholen" — der ursprüngliche Absender kann eine noch offene
    // Übergabe jederzeit selbst beenden (z. B. falscher Empfänger), ohne
    // auf die Rückgabe zu warten.
    isAuthor: boolean
  } | null
  /** Ruhige Kopfzeile oben (Stefan 2026-08-25) — bei E-Rechnung rein lesend aus dem XML,
   * sonst editierbar direkt hier statt eines zweiten Formulars weiter unten, siehe ERechnungView.tsx. */
  format: DocFormat | null
  erechnungData: ParsedInvoiceData | null
  validation: Validation | null
  /** Inland/EU/Drittland (Stefan 2026-08-25) — vom Server ermittelt (Invoice.taxRegion, sonst aus dem Länder-Code abgeleitet), siehe page.tsx. */
  effectiveRegion: TaxRegion | null
  buyerNameCheck: { invoiceId: string; expected: string; actual: string; acknowledged: boolean; locked: boolean } | null
  /** Korb-Recht APPROVE ("Sachlich freigeben") auf dem aktuellen Korb — Freigeben jetzt auch hier möglich, nicht nur in der Rechnungsliste (Stefan 2026-08-25), siehe page.tsx. */
  canApprove: boolean
  /** Pflichtangaben-Schnellausfüllung (Stefan 2026-08-27, "wenn er den Lieferant schon kennt") — zuletzt gesehene Anschrift/USt-ID/Steuernummer/Land dieses Lieferanten, siehe lib/vendorMemory.ts. Null, wenn nichts hinterlegt oder bei aktiver Verschlüsselung (dann ohnehin serverseitig nie befüllt). */
  vendorSuggestion: { address: string | null; vatId: string | null; taxNumber: string | null; countryCode: string | null } | null
}) {
  const router = useRouter()
  const [f, setF] = useState({
    vendor: invoice.vendor,
    invoiceNumber: invoice.invoiceNumber ?? '',
    invoiceDate: invoice.invoiceDate ?? '',
    dueDate: invoice.dueDate ?? '',
    discountDueDate: invoice.discountDueDate ?? '',
    discountPercent: toInput(invoice.discountPercent),
    sellerAddress: invoice.sellerAddress ?? '',
    sellerVatId: invoice.sellerVatId ?? '',
    sellerTaxNumber: invoice.sellerTaxNumber ?? '',
    sellerCountryCode: invoice.sellerCountryCode ?? '',
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
    if (!costCenterEnabled) return
    fetch('/api/admin/cost-codes?kind=KOSTENSTELLE').then((r) => r.json()).then((d) => setCostCenters(d.codes ?? [])).catch(() => undefined)
  }, [costCenterEnabled])
  useEffect(() => {
    if (!costCarrierEnabled) return
    fetch('/api/admin/cost-codes?kind=KOSTENTRAEGER').then((r) => r.json()).then((d) => setCostCarriers(d.codes ?? [])).catch(() => undefined)
  }, [costCarrierEnabled])

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
      sellerAddress: decryptedContent.sellerAddress ?? '',
      sellerVatId: decryptedContent.sellerVatId ?? '',
      sellerTaxNumber: decryptedContent.sellerTaxNumber ?? '',
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
  // Pflichtangaben-Schnellausfüllung (Stefan 2026-08-27, "wenn er den
  // Lieferant schon kennt"): beim ersten Rendern JE LEERES Feld (nicht
  // alles-oder-nichts, genau wie lib/vendorMemory.ts getVendorDefaults für
  // Kostenstelle/Tags) mit der zuletzt gesehenen Angabe dieses Lieferanten
  // vorbefüllen — markiert wie eine KI-Vermutung (gleiche Optik), aber mit
  // eigenem Hinweistext, da es keine KI-Vermutung ist, sondern ein
  // Erfahrungswert. Läuft nur einmal beim Laden, überschreibt später von
  // Hand geleerte Felder nicht erneut.
  const [vendorFlags, setVendorFlags] = useState<string[]>([])
  useEffect(() => {
    if (!vendorSuggestion) return
    const filled: string[] = []
    setF((p) => {
      const next = { ...p }
      if (!p.sellerAddress && vendorSuggestion.address) { next.sellerAddress = vendorSuggestion.address; filled.push('sellerAddress') }
      if (!p.sellerVatId && vendorSuggestion.vatId) { next.sellerVatId = vendorSuggestion.vatId; filled.push('sellerVatId') }
      if (!p.sellerTaxNumber && vendorSuggestion.taxNumber) { next.sellerTaxNumber = vendorSuggestion.taxNumber; filled.push('sellerTaxNumber') }
      if (!p.sellerCountryCode && vendorSuggestion.countryCode) { next.sellerCountryCode = vendorSuggestion.countryCode; filled.push('sellerCountryCode') }
      return filled.length > 0 ? next : p
    })
    if (filled.length > 0) setVendorFlags(filled)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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

  // Annahmeempfehlung + Prüfbericht (Stefan 2026-08-26): fasst die schon
  // vorhandenen Signale (Pflichtangaben, Dublette, Spam-Klassifikation,
  // Empfänger-Abweichung, unbestätigte/unsichere KI-Werte) zu EINER Ampel
  // zusammen, statt dass der Bearbeiter jedes einzeln selbst zusammenzählen
  // muss. Jeder EINZELNE Punkt bleibt als eigene Zeile im Prüfbericht
  // erhalten (auch die unauffälligen, als "✓ ok") — Grundlage für den
  // Workflow-Wunsch "Annahmeempfehlung (oder Ablehnung, je nach Schwere)".
  // Reine Anzeige, setzt nichts automatisch — die eigentliche Entscheidung
  // (Status "Abgelehnt", "Prüfung ignorieren" etc.) bleibt Handarbeit.
  type CheckStatus = 'ok' | 'warn' | 'fail'
  type CheckRow = { label: string; status: CheckStatus; detail: string; subItems?: { label: string; ok: boolean }[] }
  // E-Rechnungsvalidierung im Detail (Stefan 2026-08-26): welches Format,
  // welche Steuerregion wurde zugrunde gelegt und warum, und — statt nur der
  // Sammel-Meldung "X Pflichtangabe(n) fehlen" — jede einzelne geprüfte
  // Pflichtangabe mit ok/fehlt (siehe validateData()-Rückgabefeld `checks`,
  // lib/erechnung.ts).
  const isStructuredFormat = format !== null && (EINVOICE_FORMATS as string[]).includes(format)
  const eInvoiceInfo = {
    formatLabel: format ? FORMAT_LABELS[format] : '—',
    structured: isStructuredFormat,
    // Stefan 2026-08-26 ("welcher Validator wurde benutzt"): ehrlich
    // ausweisen, DASS und WIE geprüft wurde — die App macht keine
    // vollständige Schema-/Schematron-Prüfung gegen das offizielle
    // XRechnung-/ZUGFeRD-Regelwerk (z. B. KoSIT-Validator), sondern eine
    // eigene, einfachere Vollständigkeitsprüfung der Pflichtangaben.
    validatorLabel: 'Interne Pflichtangaben-Prüfung (validateData, lib/erechnung.ts)',
    validatorDetail:
      'Prüft die Vollständigkeit der Pflichtangaben nach §14 UStG / EN 16931 Kernelementen — ' +
      'KEINE vollständige Schema-/Schematron-Validierung gegen das offizielle XRechnung-/ZUGFeRD-Regelwerk ' +
      '(z. B. den KoSIT-Validator). Für eine rechtsverbindliche Konformitätsprüfung ggf. zusätzlich extern validieren.',
    electronic: invoice.checkElectronicAt
      ? { ok: true, detail: `${invoice.checkElectronicBy ?? '—'} am ${new Date(invoice.checkElectronicAt).toLocaleString('de-DE')}` }
      : { ok: false, detail: 'Noch offen' },
    regionLabel: effectiveRegion ? TAX_REGION_LABELS[effectiveRegion] : 'nicht ermittelbar (kein Länder-Code erkannt)',
    pflichtangabenChecks: validation?.checks ?? null,
  }
  const checks: CheckRow[] = [
    invoice.invoiceClass === 'NOT_INVOICE'
      ? { label: 'Spam/Fehlleitung-Klassifikation', status: 'fail', detail: `Mail-Eingang stuft dies als vermutlich keine Rechnung ein${invoice.invoiceClassConfidence !== null ? ` (${invoice.invoiceClassConfidence}% Sicherheit)` : ''}.` }
      : invoice.invoiceClass === 'UNCERTAIN'
        ? { label: 'Spam/Fehlleitung-Klassifikation', status: 'warn', detail: `Mail-Eingang ist sich nicht sicher, ob es sich um eine Rechnung handelt${invoice.invoiceClassConfidence !== null ? ` (${invoice.invoiceClassConfidence}% Sicherheit)` : ''}.` }
        : { label: 'Spam/Fehlleitung-Klassifikation', status: 'ok', detail: 'Eindeutig als Rechnung erkannt.' },
    invoice.duplicateOfId
      ? { label: 'Dubletten-Prüfung', status: 'fail', detail: 'Mögliche Dublette einer bereits vorhandenen Rechnung.' }
      : { label: 'Dubletten-Prüfung', status: 'ok', detail: 'Keine Dublette erkannt.' },
    validationMissing && validationMissing.length > 0 && !invoice.pflichtangabenIgnoredAt
      ? { label: 'Pflichtangaben (§14 UStG / EN 16931)', status: 'fail', detail: `Fehlend: ${validationMissing.join(', ')}.`, subItems: validation?.checks }
      : invoice.pflichtangabenIgnoredAt
        ? { label: 'Pflichtangaben (§14 UStG / EN 16931)', status: 'warn', detail: `Prüfung ignoriert — Grund: ${invoice.pflichtangabenIgnoredReason ?? '—'}.`, subItems: validation?.checks }
        : { label: 'Pflichtangaben (§14 UStG / EN 16931)', status: 'ok', detail: validation ? 'Vollständig.' : 'Keine strukturierten Daten zum Prüfen vorhanden.', subItems: validation?.checks },
    buyerNameCheck
      ? buyerNameCheck.acknowledged
        ? { label: 'Rechnungsempfänger-Abgleich', status: 'warn', detail: `Abweichung bestätigt ("Passt trotzdem") — erwartet „${buyerNameCheck.expected}", Beleg nennt „${buyerNameCheck.actual}".` }
        : { label: 'Rechnungsempfänger-Abgleich', status: 'fail', detail: `Weicht vom hinterlegten Firmennamen ab — erwartet „${buyerNameCheck.expected}", Beleg nennt „${buyerNameCheck.actual}".` }
      : { label: 'Rechnungsempfänger-Abgleich', status: 'ok', detail: 'Stimmt mit hinterlegter Firmenbezeichnung überein (oder kein Abgleich hinterlegt).' },
    needsAiConfirm
      ? { label: 'KI-Bestätigung', status: 'warn', detail: `Von der KI erkannte Werte noch nicht bestätigt (${reviewedCount}/${activeReviewFields.length} geprüft).` }
      : { label: 'KI-Bestätigung', status: 'ok', detail: invoice.aiAssisted ? 'Von der KI erkannte Werte wurden bestätigt.' : 'Nicht per KI erfasst.' },
    aiFlags.length > 0
      ? { label: 'KI-Unsicherheit einzelner Felder', status: 'warn', detail: `KI ist sich unsicher bei: ${aiFlags.join(', ')}.` }
      : { label: 'KI-Unsicherheit einzelner Felder', status: 'ok', detail: 'Keine als unsicher markierten Felder.' },
  ]
  const recommendation = (() => {
    const worst = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'ok'
    const level = worst === 'fail' ? 'reject' : worst === 'warn' ? 'review' : 'accept'
    const reasons = checks.filter((c) => c.status !== 'ok').map((c) => c.detail)
    return { level: level as 'accept' | 'review' | 'reject', reasons }
  })()
  const RECOMMENDATION_STYLE = {
    accept: { icon: '✓', label: 'Annahme', className: 'bg-[var(--accent-bg)] text-[var(--accent)]' },
    review: { icon: '⚠', label: 'Prüfen', className: 'bg-[var(--warn-bg)] text-[var(--warn-strong)]' },
    reject: { icon: '⛔', label: 'Klärung nötig', className: 'bg-red-50 text-[var(--danger)]' },
  } as const

  // Stefan 2026-08-26 ("wenn ich alle Felder auf geprüft setze, sollte auch
  // gleich der Haken gesetzt werden und ggf. der Freigabe-Button
  // eingeblendet werden"): sobald das letzte Feld bestätigt ist, sofort
  // confirmAi (+ checkFormal, falls nicht durch "Klärung nötig" gesperrt) im
  // Hintergrund speichern statt auf den separaten "Speichern"-Klick zu warten
  // (der zusätzlich nötig war UND danach zur Liste zurückspringt, siehe
  // save() — der freigeschaltete Freigabe-Button war auf dieser Seite also nie
  // sichtbar). Zwei GETRENNTE Requests statt einem gebündelten: die serverseitige
  // Freigabe-Sperre (getApprovalBlockers, api/invoices/[id]/route.ts) prüft
  // NUR bei checkFormal/checkSubstantive und lehnt dann den GANZEN Request ab
  // — in einem Request wäre confirmAi (unabhängig von Spam-/Dubletten-Verdacht
  // immer erlaubt) fälschlich mitblockiert worden. autoConfirmingRef verhindert
  // einen doppelten Request bei React-StrictMode-Doppel-Aufruf im Dev-Modus;
  // allReviewed fällt nach dem Refresh von selbst auf false zurück (needsAiConfirm
  // wird dann durch invoice.aiConfirmedAt false), der Effekt feuert also nicht erneut.
  const autoConfirmingRef = useRef(false)
  useEffect(() => {
    if (!allReviewed || autoConfirmingRef.current) return
    autoConfirmingRef.current = true
    setBusy(true)
    ;(async () => {
      try {
        const confirmRes = await fetch(`/api/invoices/${invoice.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmAi: true }),
        })
        if (!confirmRes.ok) {
          const data = await confirmRes.json().catch(() => ({}))
          setMsg(data.error ?? 'Bestätigung der KI-Werte fehlgeschlagen.')
          return
        }
        if (!invoice.checkFormalAt && recommendation.level !== 'reject') {
          const formalRes = await fetch(`/api/invoices/${invoice.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkFormal: true, checkFormalAuto: true }),
          })
          if (!formalRes.ok) {
            const data = await formalRes.json().catch(() => ({}))
            setMsg(data.error ?? 'Formale Prüfung konnte nicht automatisch gesetzt werden.')
          }
        }
        router.refresh()
      } catch {
        setMsg('Automatische Bestätigung fehlgeschlagen (Netzwerk) — bitte erneut versuchen oder manuell speichern.')
      } finally {
        autoConfirmingRef.current = false
        setBusy(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReviewed])
  const CHECK_STATUS_STYLE: Record<CheckStatus, { icon: string; className: string }> = {
    ok: { icon: '✓', className: 'text-[var(--accent)]' },
    warn: { icon: '⚠', className: 'text-[var(--warn-strong)]' },
    fail: { icon: '⛔', className: 'text-[var(--danger)]' },
  }
  const [showReport, setShowReport] = useState(false)
  // KoSIT-Prüfung (Stefan 2026-08-26) — die offizielle Schema-/Schematron-
  // Konformitätsprüfung der Koordinierungsstelle für IT-Standards, ergänzt
  // die eigene, schnelle Pflichtangaben-Prüfung. Läuft inzwischen automatisch
  // im Hintergrund direkt nach Ablage (lib/kositValidator.ts scheduleKositCheck)
  // — das gespeicherte Ergebnis wird hier direkt vorbelegt, "Erneut prüfen"
  // löst bei Bedarf einen frischen, ein paar Sekunden dauernden Lauf aus
  // (Java-Start), siehe api/invoices/[id]/kosit-check.
  const [kositBusy, setKositBusy] = useState(false)
  const [kositResult, setKositResult] = useState<{
    structurallyValid: boolean
    accepted: boolean | null
    scenarioName: string | null
    messages: { level: string; code: string | null; text: string }[]
  } | null>(
    invoice.kositCheckedAt
      ? {
          structurallyValid: invoice.kositAccepted !== null,
          accepted: invoice.kositAccepted,
          scenarioName: invoice.kositScenario,
          messages: invoice.kositMessages ?? [],
        }
      : null,
  )
  const [kositError, setKositError] = useState('')
  async function runKositCheck() {
    setKositBusy(true)
    setKositError('')
    setKositResult(null)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/kosit-check`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setKositError(data.error ?? 'KoSIT-Prüfung fehlgeschlagen.')
        return
      }
      setKositResult(data.result)
      // Stefan 2026-08-26: der KoSIT-Lauf kann jetzt auch checkFormalAt setzen/
      // zurücknehmen (siehe lib/kositValidator.ts runAndStoreKositCheck) — ohne
      // refresh bliebe der F-Punkt/Freigeben-Button bis zum nächsten Laden auf
      // dem alten (serverseitig bereits überholten) Stand stehen.
      router.refresh()
    } catch {
      setKositError('KoSIT-Prüfung fehlgeschlagen.')
    } finally {
      setKositBusy(false)
    }
  }
  // Prüfbericht als Text (Stefan 2026-08-26) — für die optionale Checkbox
  // "Prüfbericht einfügen" in RequestCorrectionForm.tsx, dieselben Daten wie
  // im Prüfbericht-Fenster, nur als Klartext statt JSX.
  const reportText = [
    `Prüfbericht (${RECOMMENDATION_STYLE[recommendation.level].label}):`,
    ``,
    `E-Rechnungsvalidierung:`,
    `- Format: ${eInvoiceInfo.formatLabel}${eInvoiceInfo.structured ? ' (strukturiertes E-Rechnungs-Format)' : ' (kein E-Rechnungs-Format — PDF/Scan)'}`,
    `- Elektronische Vorprüfung: ${eInvoiceInfo.electronic.ok ? '✓' : '–'} ${eInvoiceInfo.electronic.detail}`,
    `- Zugrunde gelegte Steuerregion: ${eInvoiceInfo.regionLabel}`,
    `- Validator: ${eInvoiceInfo.validatorLabel}`,
    ``,
    ...checks.flatMap((c) => [
      `${CHECK_STATUS_STYLE[c.status].icon} ${c.label}: ${c.detail}`,
      ...(c.subItems ?? []).map((s) => `   ${s.ok ? '✓' : '✗'} ${s.label}`),
    ]),
  ].join('\n')
  function reviewKeyDown(field: ReviewField) {
    return (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Tab' || !needsAiConfirm) return
      setReviewStatus((p) => ({ ...p, [field]: e.shiftKey ? 'flagged' : 'confirmed' }))
    }
  }
  // "Alle Punkte als validiert kennzeichnen" (Stefan 2026-08-26): bestätigt
  // alle noch offenen KI-Felder auf einen Schlag statt einzeln per Tab —
  // ersetzt keine echte Prüfung, deshalb Warnhinweis davor (einmalig, mit
  // dauerhafter Abschalt-Möglichkeit in localStorage, pro Browser).
  const BULK_CONFIRM_DISMISS_KEY = 'invoiceBulkConfirmWarningDismissed'
  const [showBulkConfirmWarning, setShowBulkConfirmWarning] = useState(false)
  const [bulkConfirmDontShowAgain, setBulkConfirmDontShowAgain] = useState(false)
  function confirmAllFields() {
    setReviewStatus(Object.fromEntries(activeReviewFields.map((k) => [k, 'confirmed'])) as Record<ReviewField, ReviewStatus>)
  }
  function bulkConfirmClick() {
    let dismissed = false
    try {
      dismissed = localStorage.getItem(BULK_CONFIRM_DISMISS_KEY) === '1'
    } catch {
      // s. u. — ohne localStorage einfach jedes Mal den Hinweis zeigen
    }
    if (dismissed) {
      confirmAllFields()
    } else {
      setShowBulkConfirmWarning(true)
    }
  }
  function bulkConfirmProceed() {
    confirmAllFields()
    if (bulkConfirmDontShowAgain) {
      try {
        localStorage.setItem(BULK_CONFIRM_DISMISS_KEY, '1')
      } catch {
        // s. o.
      }
    }
    setShowBulkConfirmWarning(false)
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
        sellerAddress: string | null; sellerVatId: string | null; sellerTaxNumber: string | null
        sellerCountryCode: string | null
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
        sellerAddress: d.sellerAddress ?? p.sellerAddress,
        sellerVatId: d.sellerVatId ?? p.sellerVatId,
        sellerTaxNumber: d.sellerTaxNumber ?? p.sellerTaxNumber,
        sellerCountryCode: d.sellerCountryCode ?? p.sellerCountryCode,
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
      // Land des Lieferanten (Stefan 2026-08-25) — technische Kennung für die
      // Inland/EU/Drittland-Einordnung, nicht selbst identifizierend, deshalb
      // bewusst außerhalb der Inhalts-Verschlüsselung (analog costCenterCode).
      sellerCountryCode: f.sellerCountryCode || null,
      ...(costCenterEnabled ? { costCenterCode: f.costCenterCode || null } : {}),
      ...(costCarrierEnabled ? { costCarrierCode: f.costCarrierCode || null } : {}),
      ...(usedAi ? { aiAssisted: true } : {}),
      ...(allReviewed ? { confirmAi: true as const } : {}),
      // Stefan 2026-08-26: sobald alle KI-Felder bestätigt sind, gilt die
      // formale Prüfung als erledigt — kein zusätzlicher F-Klick nötig, sonst
      // unverändert manuell setzbar (z. B. bei rein manuell erfassten Belegen).
      ...(allReviewed && !invoice.checkFormalAt ? { checkFormal: true as const } : {}),
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
        sellerAddress: f.sellerAddress, sellerVatId: f.sellerVatId, sellerTaxNumber: f.sellerTaxNumber,
      })
      // Blind-Index für die Suche (Stefan 2026-08-27, siehe lib/clientCrypto.ts
      // deriveSearchKey/computeSearchTokens) — bewusst nur Lieferant +
      // Rechnungsnummer, nicht Notizen (kleinere Angriffsfläche für das
      // Gleichheits-Leck, siehe dortiger Kommentar). dekRaw steht garantiert
      // zur Verfügung, sobald dek oben erfolgreich ermittelt wurde (beide
      // Wege — Cache wie frisches Entsperren — hinterlegen dieselben
      // Rohbytes im selben sessionStorage-Eintrag).
      const dekRaw = getCachedDekRaw()
      const searchTokens = dekRaw
        ? await computeSearchTokens(await deriveSearchKey(dekRaw), `${f.vendor} ${f.invoiceNumber}`)
        : []
      body = { ...base, contentEnc, searchTokenHashes: searchTokens }
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
        sellerAddress: f.sellerAddress || null,
        sellerVatId: f.sellerVatId || null,
        sellerTaxNumber: f.sellerTaxNumber || null,
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
    // Nach dem Speichern automatisch zurück zur Liste (Stefan 2026-08-25) —
    // vorher blieb man auf der Detailseite stehen und musste selbst "Zurück"
    // klicken, obwohl das nach einem erfolgreichen Speichern der übliche
    // nächste Schritt ist.
    router.push('/invoices')
  }

  // "Zur Prüfung weitergeben" — Rückgabe/Zurückholen (Stefan 2026-08-27):
  // kein "Freigeben" — der Empfänger entscheidet einfach, wann die Rechnung
  // wieder normal bearbeitbar sein soll ("Zurückgeben"), ODER der Absender
  // beendet die Übergabe selbst vorzeitig ("Zurückholen") — dieselbe
  // Aktion serverseitig, siehe lib/invoiceHandoff.ts und
  // api/invoices/[id]/notes/[noteId]/route.ts.
  async function returnHandoff() {
    if (!activeHandoff) return
    setBusy(true)
    setMsg('')
    const res = await fetch(`/api/invoices/${invoice.id}/notes/${activeHandoff.noteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: true }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setMsg(data.error ?? 'Zurückgeben fehlgeschlagen.')
      return
    }
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

  // Inland/EU/Drittland manuell überschreiben (Stefan 2026-08-25) — sofort
  // gespeichert statt über den Haupt-Speichern-Knopf, wie die Prüf-Häkchen
  // unten: eine gelegentliche Korrektur, kein Teil des laufenden Formulars.
  async function setTaxRegion(region: string) {
    setBusy(true)
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taxRegion: region || null }),
    })
    setBusy(false)
    if (res.ok) router.refresh()
    else setMsg('Land/Region konnte nicht gespeichert werden.')
  }

  // "Prüfung ignorieren" (Stefan 2026-08-25) — Begründung ist Pflicht (auch
  // clientseitig schon abgefragt, Server erzwingt es zusätzlich).
  async function toggleIgnore(ignored: boolean) {
    let reason: string | null = null
    if (ignored) {
      reason = window.prompt('Kurze Begründung, warum die Pflichtangaben-Prüfung für diese Rechnung ignoriert werden soll:')
      if (!reason || !reason.trim()) return
    }
    setBusy(true)
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pflichtangabenIgnored: ignored, pflichtangabenIgnoredReason: reason }),
    })
    setBusy(false)
    if (res.ok) router.refresh()
    else setMsg('Konnte nicht gespeichert werden.')
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

  // "Sachlich freigeben" hier togglebar (Stefan 2026-08-25, bisher nur in der
  // Rechnungsliste, siehe CheckBadges.tsx). "An Buchhaltung übergeben"
  // SETZEN ist nicht Teil davon (Stefan 2026-08-26, "wir machen so immer mehr
  // Buchungsstapel") — die Übergabe an die Fibu darf nur noch über die
  // Sammelfunktion (DatevExportButton.tsx im Übergabekorb) passieren.
  // ZURÜCKNEHMEN (false) bleibt hier möglich (Review-Fund "kein Weg mehr, B
  // zu korrigieren"), server-seitig weiterhin auf Admin beschränkt, sobald
  // die Rechnung schon in der Ablage liegt.
  async function toggleApproval(key: 'checkSubstantive' | 'checkAccounting', value: boolean) {
    setBusy(true)
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg(data.error ?? 'Prüfschritt konnte nicht gespeichert werden.')
      return
    }
    if (data?.autoMoveApprovalPending) {
      window.alert(
        `Freigabe für automatischen Wechsel in den Übergabekorb erfasst — noch ${data.autoMoveApprovalPending.approvalsNeeded} weitere Freigabe(n) durch einen anderen Mitarbeiter nötig (Vier-Augen-Korb).`,
      )
      router.refresh()
      return
    }
    if (data?.autoMoved) {
      setMsg(`✓ Vollständig geprüft → automatisch in „${data.autoMoved.targetBasketName}" verschoben`)
      setTimeout(() => router.refresh(), 1200)
      return
    }
    router.refresh()
  }

  // Ein-Klick-Freigabe (Stefan 2026-08-26): bündelt so viele Prüfschritte in
  // EINEM PATCH, wie der Bearbeiter laut seinen Korb-Rechten (canApprove/
  // canHandover) überhaupt setzen darf — die API akzeptiert mehrere check*-
  // Flags im selben Aufruf und wendet die automatische Übergabekorb-/Fibu-
  // Weiterleitung dann direkt mit an (siehe api/invoices/[id]/route.ts
  // effectiveSubstantive/effectiveAccounting). Die einzelnen E/F/S/B-Chips
  // bleiben daneben bestehen — als Prüfnachweis und für den Fall, dass jemand
  // gezielt nur EINEN Schritt setzen/zurücknehmen will.
  function primaryAction(): { label: string; title: string; body: Record<string, boolean> } | null {
    if (invoice.checkAccountingAt) return null
    // Stefan 2026-08-26 ("wirklich freigeben kann ich aber nur wenn alle
    // Punkte behoben sind"): bei "Klärung nötig" (mind. ein fail-Punkt im
    // Prüfbericht — Spam-Verdacht, Dublette, fehlende Pflichtangaben,
    // Empfänger-Abweichung) gibt es hier keinen Button — weder für "Formal
    // geprüft" noch für "Freigeben". Bloßes "Prüfen" (nur gelbe Punkte, z. B.
    // KI-Unsicherheit) sperrt bewusst NICHT, sonst wäre der Workflow bei
    // harmlosen Restunsicherheiten komplett blockiert.
    if (recommendation.level === 'reject') return null
    if (!invoice.checkFormalAt) {
      return canApprove
        ? { label: 'Prüfen & freigeben', title: 'Formal und sachlich prüfen, bei entsprechendem Recht direkt weiterleiten', body: { checkFormal: true, checkSubstantive: true } }
        : { label: 'Formal geprüft', title: 'Nur formale Prüfung — für die sachliche Prüfung fehlt dir das Recht', body: { checkFormal: true } }
    }
    if (!invoice.checkSubstantiveAt) {
      return canApprove
        ? { label: 'Freigeben', title: 'Sachlich richtig — Rechnung damit vollständig geprüft', body: { checkSubstantive: true } }
        : null
    }
    // Stefan 2026-08-26 ("wir machen so immer mehr Buchungsstapel"): kein
    // Einzel-Übergabe-Knopf mehr — vollständig geprüfte Rechnungen wandern
    // automatisch in den Übergabekorb (siehe Server-Logik) und warten dort
    // auf die SAMMEL-Übergabe per DATEV-Export (DatevExportButton.tsx), statt
    // einzeln und sofort in die Ablage zu springen, ohne je in einem
    // Buchungsstapel zu landen.
    return null
  }
  const primary = primaryAction()
  // Kleine Belohnungs-Animation nach "Prüfen & freigeben" (Stefan 2026-08-26)
  // — ein großer, transparenter grüner Haken über dem Gesamtbetrag, klingt
  // nach 1,8s wieder ab. Nur bei echtem Erfolg, nicht bei einer noch
  // ausstehenden Vier-Augen-Freigabe.
  const [showPrimarySuccess, setShowPrimarySuccess] = useState(false)
  function celebrate() {
    setShowPrimarySuccess(true)
    setTimeout(() => setShowPrimarySuccess(false), 1800)
  }
  async function runPrimaryAction() {
    if (!primary) return
    // Stefan 2026-08-26 ("Freigeben erst nach expliziter Bestätigung, falls
    // die Prüfung Fehler gefunden hat"): "Formal richtig" wird bei E-Rechnungen
    // inzwischen automatisch aus dem KoSIT-Ergebnis gesetzt (siehe
    // lib/kositValidator.ts runAndStoreKositCheck) — hat KoSIT die Rechnung
    // zurückgewiesen, bleibt der Haken offen, aber der reine "Klärung nötig"-
    // Block (recommendation.level) greift dafür NICHT (das wäre zu hart für
    // z. B. nur eine Warnung im KoSIT-Bericht) — stattdessen hier eine explizite
    // Rückfrage, bevor trotzdem freigegeben wird.
    if (isStructuredFormat && kositResult?.accepted === false) {
      const errText = kositResult.messages
        .filter((m) => m.level === 'error' || m.level === 'fatal')
        .map((m) => `- ${m.text}`)
        .join('\n')
      const warnText =
        `Die automatische KoSIT-Prüfung hat diese E-Rechnung zurückgewiesen` +
        `${kositResult.scenarioName ? ` (Szenario: ${kositResult.scenarioName})` : ''}.` +
        `${errText ? `\n\n${errText}` : ''}` +
        `\n\nTrotzdem freigeben?`
      if (!window.confirm(warnText)) return
    }
    setBusy(true)
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(primary.body),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg(data.error ?? 'Konnte nicht gespeichert werden.')
      return
    }
    if (data?.autoMoveApprovalPending) {
      window.alert(
        `Freigabe für automatischen Wechsel in den Übergabekorb erfasst — noch ${data.autoMoveApprovalPending.approvalsNeeded} weitere Freigabe(n) durch einen anderen Mitarbeiter nötig (Vier-Augen-Korb).`,
      )
      router.refresh()
      return
    }
    celebrate()
    // Stefan 2026-08-26 ("nach prüfen und freigeben muss in die liste
    // zurückgesprungen werden"): nach einem echten Abschluss (nicht nur einer
    // von zwei nötigen Vier-Augen-Stimmen oben) ist die Detailseite fertig
    // bearbeitet — zurück zur Liste, statt hier stehen zu bleiben. Kurze
    // Verzögerung, damit der grüne Haken (celebrate()) noch sichtbar wird.
    if (data?.autoMoved) {
      setMsg(`✓ Vollständig geprüft → automatisch in „${data.autoMoved.targetBasketName}" verschoben`)
    }
    setTimeout(() => {
      router.push('/invoices')
      router.refresh()
    }, 1200)
  }

  // Editierbare Kopfzeile (Stefan 2026-08-25) — nur bei Nicht-E-Rechnungen: die
  // Rechnungsdaten werden direkt hier oben eingegeben statt in einem zweiten
  // Formular weiter unten (siehe ERechnungView.tsx, Feldgruppe unten dafür
  // entsprechend ausgeblendet).
  const edit: EditBundle | undefined = isEInvoice ? undefined : {
    vendor: {
      value: f.vendor, onChange: (v) => set('vendor', v), required: true,
      warn: aiFlags.includes('vendor'), reviewStatus: needsAiConfirm ? reviewStatus.vendor : undefined,
      onKeyDown: reviewKeyDown('vendor'),
    },
    number: {
      value: f.invoiceNumber, onChange: (v) => set('invoiceNumber', v),
      warn: aiFlags.includes('invoiceNumber'), reviewStatus: needsAiConfirm ? reviewStatus.invoiceNumber : undefined,
      onKeyDown: reviewKeyDown('invoiceNumber'),
    },
    issueDate: {
      value: f.invoiceDate, onChange: (v) => set('invoiceDate', v),
      warn: aiFlags.includes('invoiceDate'), reviewStatus: needsAiConfirm ? reviewStatus.invoiceDate : undefined,
      onKeyDown: reviewKeyDown('invoiceDate'),
    },
    dueDate: {
      value: f.dueDate, onChange: (v) => set('dueDate', v),
      warn: aiFlags.includes('dueDate'), reviewStatus: needsAiConfirm ? reviewStatus.dueDate : undefined,
      onKeyDown: reviewKeyDown('dueDate'),
    },
    discountDueDate: { value: f.discountDueDate, onChange: (v) => set('discountDueDate', v), optional: true },
    discountPercent: { value: f.discountPercent, onChange: (v) => set('discountPercent', v), optional: true },
    sellerAddress: {
      value: f.sellerAddress, onChange: (v) => set('sellerAddress', v),
      warn: aiFlags.includes('sellerAddress') || vendorFlags.includes('sellerAddress'),
      hintTitle: vendorFlags.includes('sellerAddress') ? VENDOR_SUGGESTION_HINT : undefined,
    },
    // Stefan 2026-08-26: keine Pflichtangabe mehr bei Nicht-E-Rechnung — die
    // Lieferanten-Zuordnung in der Fibu läuft in der Praxis über die
    // Kontonummer (siehe VendorAccount), USt-IdNr./Steuernummer sind eher
    // Fibu-Stammdaten. Siehe missingEditFields() in ERechnungView.tsx.
    sellerVatId: {
      value: f.sellerVatId, onChange: (v) => set('sellerVatId', v),
      warn: aiFlags.includes('sellerVatId') || vendorFlags.includes('sellerVatId'), optional: true,
      hintTitle: vendorFlags.includes('sellerVatId') ? VENDOR_SUGGESTION_HINT : undefined,
    },
    sellerTaxNumber: {
      value: f.sellerTaxNumber, onChange: (v) => set('sellerTaxNumber', v),
      warn: aiFlags.includes('sellerTaxNumber') || vendorFlags.includes('sellerTaxNumber'), optional: true,
      hintTitle: vendorFlags.includes('sellerTaxNumber') ? VENDOR_SUGGESTION_HINT : undefined,
    },
    net: {
      value: f.amountNet, onChange: (v) => set('amountNet', v),
      warn: aiFlags.includes('amountNet'), reviewStatus: needsAiConfirm ? reviewStatus.amountNet : undefined,
      onKeyDown: reviewKeyDown('amountNet'),
    },
    tax: {
      value: f.amountTax, onChange: (v) => set('amountTax', v),
      warn: aiFlags.includes('amountTax'), reviewStatus: needsAiConfirm ? reviewStatus.amountTax : undefined,
      onKeyDown: reviewKeyDown('amountTax'),
    },
    gross: {
      value: f.amountGross, onChange: (v) => set('amountGross', v),
      warn: aiFlags.includes('amountGross'), reviewStatus: needsAiConfirm ? reviewStatus.amountGross : undefined,
      onKeyDown: reviewKeyDown('amountGross'),
    },
    currency: { value: f.currency, onChange: (v) => set('currency', v) },
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
      {locked && supersededByInvoiceId && (
        <div className="dp-card border-2 border-gray-300 bg-[var(--surface-muted)] text-sm text-gray-600">
          🕓 Diese Rechnung wurde durch eine neuere, gleichlautende Version (gleiche Rechnungsnummer + Lieferant)
          {' '}ersetzt und ist schreibgeschützt — keine Änderungen, kein Verschieben, kein Löschen mehr möglich.{' '}
          <a className="font-semibold text-[var(--accent)] underline" href={`/invoices/${supersededByInvoiceId}`}>
            Aktuelle Version ansehen →
          </a>
        </div>
      )}
      {locked && !supersededByInvoiceId && !activeHandoff && (
        <div className="dp-card border-2 border-gray-300 bg-[var(--surface-muted)] text-sm text-gray-600">
          🔒 Diese Rechnung gehört zum abgeschlossenen Prüfungszeitraum {new Date(invoice.createdAt).getFullYear()}
          {' '}und ist schreibgeschützt — keine Änderungen, kein Verschieben, kein Löschen mehr möglich.
        </div>
      )}
      {/* "Zur Prüfung weitergeben" (Stefan 2026-08-27, siehe lib/invoiceHandoff.ts)
          — zwei Ansichten: der Empfänger sieht die Nachricht + kann
          zurückgeben (Formular bleibt für ihn normal bearbeitbar, kein
          fieldset-Schreibschutz); alle anderen sehen nur, an wen übergeben
          wurde, und die Rechnung ist grau/schreibgeschützt (fieldset unten). */}
      {activeHandoff && activeHandoff.isRecipient && (
        <div className="dp-card border-2 border-[var(--accent-border)] bg-[var(--accent-bg)] text-sm">
          <p className="font-semibold text-[var(--accent)]">
            📤 Zur Prüfung übergeben von {activeHandoff.authorName} am {new Date(activeHandoff.createdAt).toLocaleString('de-DE')}
          </p>
          {activeHandoff.subject && <p className="mt-1 font-semibold text-gray-800">{activeHandoff.subject}</p>}
          <p className="mt-1 whitespace-pre-wrap text-gray-700">{activeHandoff.text}</p>
          <p className="mt-2 text-xs text-gray-500">
            Solange Sie nicht zurückgeben, ist die Rechnung für alle anderen schreibgeschützt — kein
            Freigeben nötig, einfach zurückgeben, sobald Sie fertig sind.
          </p>
          <button type="button" className="btn-primary mt-2" onClick={returnHandoff} disabled={busy}>
            {busy ? 'Gebe zurück …' : '↩ Zurückgeben'}
          </button>
        </div>
      )}
      {activeHandoff && !activeHandoff.isRecipient && (
        <div className="dp-card border-2 border-gray-300 bg-[var(--surface-muted)] text-sm text-gray-600">
          📤 Zur Prüfung an <strong>{activeHandoff.toUserName}</strong> übergeben (von {activeHandoff.authorName} am{' '}
          {new Date(activeHandoff.createdAt).toLocaleString('de-DE')}) — schreibgeschützt, bis{' '}
          {activeHandoff.toUserName} sie zurückgibt.
          {activeHandoff.isAuthor && (
            <>
              <br />
              <button type="button" className="btn-secondary mt-2" onClick={returnHandoff} disabled={busy}
                title="Übergabe beenden, ohne auf die Rückgabe zu warten — z. B. bei versehentlich falschem Empfänger">
                {busy ? 'Hole zurück …' : '↩ Zurückholen'}
              </button>
            </>
          )}
        </div>
      )}
      <fieldset disabled={locked} className="contents border-0 p-0">
      <ERechnungView
        format={format ?? 'OTHER'}
        data={erechnungData}
        validation={validation}
        docId={invoice.docId}
        receivedInfo={`📥 ${SOURCE_LABELS[invoice.source] ?? invoice.source} am ${new Date(invoice.createdAt).toLocaleString('de-DE')}`}
        celebrate={showPrimarySuccess}
        buyerNameCheck={buyerNameCheck}
        edit={edit}
        region={{ effective: effectiveRegion, onOverride: setTaxRegion, busy }}
        ignore={{
          ignored: Boolean(invoice.pflichtangabenIgnoredAt),
          reason: invoice.pflichtangabenIgnoredReason,
          by: invoice.pflichtangabenIgnoredBy,
          at: invoice.pflichtangabenIgnoredAt,
          onToggle: toggleIgnore,
          busy,
        }}
        directDebit={{
          checked: f.directDebitByVendor,
          onChange: (v) => setF((p) => ({ ...p, directDebitByVendor: v })),
          warn: aiFlags.includes('directDebitByVendor'),
        }}
      />
      {/* Positionszeilen (Stefan 2026-08-27, "gehören immer zwischen Kopf und
          Summe, exakt so wie bei den E-Rechnungen"): keine eigene Karte mehr
          — ERechnungView rendert sie jetzt für JEDEN Rechnungstyp an
          derselben Stelle (zwischen Kopfzeile und Summenblock), gespeist aus
          `data.lines` (page.tsx baut das bei Nicht-E-Rechnungen aus den
          KI-erkannten lineItems). Vorher sprang die Dateiansicht je nach
          Rechnungstyp unterschiedlich hoch/niedrig, weil PDF/Scan die
          Positionen als separate, zusätzliche Karte weiter unten zeigten. */}
      {/* KI-Rückmeldungen (Stefan 2026-08-25): direkt nach den Kopfdaten,
          weil sie sich auf die Felder in der Kopfzeile oben beziehen — vorher
          weiter unten in der "Rechnungsdaten"-Karte versteckt. */}
      {/* Stefan 2026-08-27 ("Übernehmen alles so machen, dass es das Bild
          nicht stört"): eine einzeilige, schmale Leiste statt der vorherigen
          mehrzeiligen Karte (Erklärabsatz + Tab-Anleitung + Button je eigene
          Zeile) — die brauchte deutlich Platz und existiert NUR bei noch
          unbestätigten KI-Werten, nie bei E-Rechnungen. Dieser Höhen-
          unterschied ließ die Seite beim Wechsel zwischen Rechnungstypen UND
          beim Bestätigen selbst (die ganze Leiste verschwindet danach)
          zusätzlich springen. Die Tab/Shift+Tab-Anleitung steckt jetzt in
          einem Tooltip (ⓘ) statt in eigenem Fließtext. */}
      {(aiError || aiWarnings.length > 0 || needsAiConfirm) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-1.5 text-xs text-[var(--warn-strong)]">
          {aiError && <span className="font-semibold text-[var(--danger)]">{aiError}</span>}
          {aiWarnings.length > 0 && <span>⚠ Bitte besonders prüfen — {aiWarnings.join(' ')}</span>}
          {needsAiConfirm && !allReviewed && (
            <>
              <span
                title="Mit Tab durch die Felder gehen (übernimmt den vorgeschlagenen Wert), bei einem falschen Wert stattdessen Shift+Tab drücken, um ihn zu markieren, und den richtigen Wert eintragen. KI-generierte Inhalte können fehlerhaft sein — bitte jeden Wert gegen den Beleg rechts prüfen, nicht blind übernehmen. Die Rechnung lässt sich erst nach vollständiger Bestätigung in einen anderen Korb verschieben."
              >
                🤖 KI-erkannte Werte noch nicht bestätigt ({reviewedCount}/{activeReviewFields.length}) — Tab zum Übernehmen, Shift+Tab bei Fehler ⓘ
              </span>
              <button type="button" className="btn-secondary !px-2 !py-0.5 text-[11px]" onClick={bulkConfirmClick}
                title="Alle noch offenen Felder auf einmal bestätigen, statt einzeln per Tab durchzugehen">
                Alle bestätigen
              </button>
            </>
          )}
          {needsAiConfirm && allReviewed && <span className="text-[var(--accent)]">✓ Alle Felder geprüft — wird automatisch bestätigt …</span>}
        </div>
      )}

      {/* Kontierung (Stefan 2026-08-25): direkt über der Status-Leiste statt in
          "Weitere Angaben" versteckt — wird für die Buchhaltung/den
          DATEV-Export gebraucht, kein gelegentliches Zusatzfeld. */}
      {(costCenterEnabled || costCarrierEnabled) && (
        <div className="dp-card grid gap-4 sm:grid-cols-2">
          {costCenterEnabled && (
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
          )}
          {costCarrierEnabled && (
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
          )}
        </div>
      )}

      {/* Status & Aktionen (Stefan 2026-08-25): bündelt Status, die vierteilige
          Prüfkette (jetzt inkl. "Sachlich freigeben"/"An Buchhaltung
          übergeben" auch hier klickbar, nicht mehr nur in der Rechnungsliste),
          Korb und die Haupt-Aktionen an einer Stelle statt verteilt über
          mehrere Karten — bleibt beim Scrollen oben sichtbar. */}
      <div className="sticky top-4 z-10 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-bg)] px-4 py-3 shadow-sm">
        <div>
          <label className="mb-1 block text-[9.5px] font-bold uppercase tracking-wide text-[var(--accent-soft)]">Empfehlung</label>
          <div className="flex items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${RECOMMENDATION_STYLE[recommendation.level].className}`}
              title={recommendation.reasons.length > 0 ? recommendation.reasons.join(' · ') : 'Keine Auffälligkeiten erkannt'}>
              {RECOMMENDATION_STYLE[recommendation.level].icon} {RECOMMENDATION_STYLE[recommendation.level].label}
            </span>
            <button type="button" className="btn-secondary !px-2 !py-1 text-[11px]" onClick={() => setShowReport(true)}
              title="Alle einzelnen Prüfpunkte im Detail anzeigen">
              📋 Prüfbericht
            </button>
            {/* Stefan 2026-08-26: von "Weitere Angaben" ganz unten nach oben
                neben den Prüfbericht geholt — inhaltlich zusammengehörig
                (Korrektur wird ja meist wegen eines Prüfbericht-Punkts
                angefordert), jetzt auch direkt sichtbar statt versteckt. */}
            <RequestCorrectionForm
              invoiceId={invoice.id}
              vendor={f.vendor}
              invoiceNumber={f.invoiceNumber || null}
              missing={validationMissing}
              suggestedEmail={suggestedVendorEmail}
              locked={locked}
              reportText={reportText}
            />
          </div>
        </div>
        <div className="h-8 w-px bg-[var(--accent-border)]" />
        <div>
          <label className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--accent-soft)]">Status</label>
          <select className="block bg-transparent text-sm font-semibold text-[var(--accent)] outline-none" value={f.status}
            onChange={(e) => set('status', e.target.value)} title="Bearbeitungsstatus für den internen Workflow — jederzeit frei änderbar">
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="h-8 w-px bg-[var(--accent-border)]" />
        <div>
          <label className="mb-1 block text-[9.5px] font-bold uppercase tracking-wide text-[var(--accent-soft)]">Prüfkette</label>
          <div className="flex items-center gap-1">
            <CheckChip letter="E" done={invoice.checkElectronicAt !== null}
              notApplicable={Boolean(invoice.checkElectronicAt && invoice.checkElectronicBy?.startsWith('System (entfällt'))}
              title={`Elektronische Vorprüfung — ${invoice.checkElectronicAt ? `${invoice.checkElectronicBy} am ${new Date(invoice.checkElectronicAt).toLocaleString('de-DE')}` : 'offen'}`}
              disabled={busy} onToggle={() => toggleCheck('checkElectronic', invoice.checkElectronicAt === null)} />
            {/* Stefan 2026-08-26 ("Freigabe wird konfus ausgeblendet"): SETZEN
                geht nur noch über den Haupt-Button oben (der zusätzlich
                sperrt, solange "Klärung nötig" — siehe primaryAction), da
                direktes Umschalten hier den Freigeben-Button unvermittelt
                verschwinden lassen konnte. ZURÜCKNEHMEN bleibt hier möglich
                (Review-Fund "kein Weg mehr, F zu korrigieren") — sonst bliebe
                ein versehentlich gesetztes F für immer stehen. */}
            <CheckChip letter="F" done={invoice.checkFormalAt !== null}
              title={invoice.checkFormalAt
                ? `Formal richtig — ${invoice.checkFormalBy} am ${new Date(invoice.checkFormalAt).toLocaleString('de-DE')} (klicken zum Zurücknehmen)`
                : 'Formal richtig — offen, wird über den Button oben gesetzt'}
              disabled={busy || !invoice.checkFormalAt} onToggle={() => toggleCheck('checkFormal', false)} />
            <CheckChip letter="S" done={invoice.checkSubstantiveAt !== null}
              title={canApprove
                ? `Sachlich richtig — ${invoice.checkSubstantiveAt ? `${invoice.checkSubstantiveBy} am ${new Date(invoice.checkSubstantiveAt).toLocaleString('de-DE')}` : 'offen'} (klicken zum Umschalten)`
                : 'Kein Recht, „Sachlich richtig" freizugeben'}
              disabled={busy || !canApprove} onToggle={() => toggleApproval('checkSubstantive', invoice.checkSubstantiveAt === null)} />
            {/* Stefan 2026-08-26: reiner Status, nicht mehr klickbar — die
                Übergabe an die Fibu passiert nur noch über die Sammel-
                funktion (DATEV-Export im Übergabekorb), nicht mehr per
                Einzel-Klick hier (siehe primaryAction/toggleApproval oben). */}
            <CheckChip letter="B" done={invoice.checkAccountingAt !== null}
              title={invoice.checkAccountingAt
                ? `An Buchhaltung übergeben — ${invoice.checkAccountingBy} am ${new Date(invoice.checkAccountingAt).toLocaleString('de-DE')} (klicken zum Zurücknehmen — nur Admin, falls schon in der Ablage)`
                : 'Übergabe an die Fibu erfolgt nur über die Sammelfunktion (DATEV-Export im Übergabekorb), nicht einzeln hier'}
              disabled={busy || !invoice.checkAccountingAt} onToggle={() => toggleApproval('checkAccounting', false)} />
          </div>
        </div>
        {baskets.length > 0 && (
          <>
            <div className="h-8 w-px bg-[var(--accent-border)]" />
            <div>
              <label className="text-[9.5px] font-bold uppercase tracking-wide text-[var(--accent-soft)]">Korb</label>
              <p className="text-sm font-semibold text-[var(--accent)]">{baskets.find((b) => b.id === invoice.basketId)?.name ?? '—'}</p>
            </div>
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {primary && (
            <button type="button" className="btn-primary" disabled={busy || needsAiConfirm}
              title={needsAiConfirm ? 'Von der KI erkannte Werte müssen erst geprüft und bestätigt werden (siehe oben).' : primary.title}
              onClick={runPrimaryAction}>
              {busy ? 'Speichere …' : primary.label}
            </button>
          )}
          {baskets.length > 0 && (
            <BasketMoveButton
              invoiceId={invoice.id}
              currentBasketId={invoice.basketId}
              baskets={baskets}
              pending={pendingApproval}
              disabled={needsAiConfirm}
              disabledReason="Von der KI erkannte Werte müssen erst geprüft und bestätigt werden (siehe oben)."
              colleagues={colleagues}
            />
          )}
          {!activeHandoff && (
            <InvoiceHandoffButton invoiceId={invoice.id} colleagues={colleagues} disabled={needsAiConfirm} />
          )}
          <InvoiceNoteButton invoiceId={invoice.id} colleagues={colleagues} />
          <button type="submit" className={primary ? 'btn-secondary' : 'btn-primary'} disabled={busy} title="Änderungen speichern">
            {busy ? 'Speichere …' : 'Speichern'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => router.push('/invoices')} title="Ohne Speichern zurück zur Liste">
            Zurück
          </button>
          <button type="button" className="btn-danger" onClick={remove} disabled={busy}
            title="Rechnung als gelöscht markieren — Beleg bleibt erhalten, im Papierkorb wiederherstellbar">
            Löschen
          </button>
        </div>
        {msg && (
          <p className={`w-full text-sm ${msg.startsWith('✓') || msg === 'Gespeichert.' ? 'text-[var(--accent)]' : 'text-[var(--danger)]'}`}>{msg}</p>
        )}
      </div>

      {showBulkConfirmWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowBulkConfirmWarning(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-lg font-semibold text-gray-800">Wirklich alle auf einmal bestätigen?</h2>
            <p className="mt-2 text-sm text-gray-600">
              Damit gelten alle noch offenen, von der KI erkannten Werte als geprüft — ohne dass du sie einzeln
              gegen den Beleg kontrolliert hast. KI-generierte Inhalte können fehlerhaft sein. Nur nutzen, wenn du dir
              wirklich sicher bist.
            </p>
            <label className="mt-3 flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={bulkConfirmDontShowAgain}
                onChange={(e) => setBulkConfirmDontShowAgain(e.target.checked)} />
              Diesen Hinweis nicht mehr anzeigen
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setShowBulkConfirmWarning(false)}>Abbrechen</button>
              <button type="button" className="btn-primary" onClick={bulkConfirmProceed}>Fortfahren</button>
            </div>
          </div>
        </div>
      )}

      {showReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowReport(false)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-serif text-lg font-semibold text-gray-800">Prüfbericht</h2>
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${RECOMMENDATION_STYLE[recommendation.level].className}`}>
                {RECOMMENDATION_STYLE[recommendation.level].icon} {RECOMMENDATION_STYLE[recommendation.level].label}
              </span>
            </div>

            {/* E-Rechnungsvalidierung im Detail (Stefan 2026-08-26): welches
                Format/welche Steuerregion wurde der Prüfung zugrunde gelegt —
                bisher stand nur die Sammel-Zeile "Pflichtangaben" da, ohne
                erkennbar zu machen, WELCHE Regel angewendet wurde. Interne
                Prüfung und offizielle KoSIT-Prüfung sind hier EIN Block
                (Stefan 2026-08-26, "im Prüfbericht zusammenfassen") — gelb =
                nur die interne Pflichtangaben-Prüfung bestanden, KoSIT noch
                nicht bestätigt; grün = zusätzlich von KoSIT akzeptiert; rot =
                von KoSIT zurückgewiesen. Vorher zwei getrennte Karten. */}
            <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3 text-xs">
              <p className="mb-1.5 font-bold uppercase tracking-wide text-gray-400">E-Rechnungsvalidierung</p>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-gray-600">
                <span className="text-gray-400">Format</span>
                <span>{eInvoiceInfo.formatLabel}{eInvoiceInfo.structured ? ' (strukturiertes E-Rechnungs-Format)' : ' (kein E-Rechnungs-Format — PDF/Scan)'}</span>
                <span className="text-gray-400">Elektronische Vorprüfung</span>
                <span className={
                  !eInvoiceInfo.electronic.ok ? 'text-[var(--warn-strong)]'
                    : kositResult?.accepted === true ? 'text-[var(--accent)]'
                      : kositResult?.accepted === false ? 'text-[var(--danger)]'
                        : 'text-[var(--warn-strong)]'
                }>
                  {!eInvoiceInfo.electronic.ok ? `– ${eInvoiceInfo.electronic.detail}`
                    : kositResult?.accepted === true ? `✓ ${eInvoiceInfo.electronic.detail} · KoSIT akzeptabel`
                      : kositResult?.accepted === false ? `⛔ ${eInvoiceInfo.electronic.detail} · KoSIT zurückgewiesen`
                        : `✓ ${eInvoiceInfo.electronic.detail} · KoSIT ${kositResult ? 'Ergebnis unklar' : 'noch nicht geprüft'}`}
                </span>
                <span className="text-gray-400">Zugrunde gelegte Steuerregion</span>
                <span>{eInvoiceInfo.regionLabel}</span>
                <span className="text-gray-400">Validator</span>
                <span title={eInvoiceInfo.validatorDetail}>{eInvoiceInfo.validatorLabel}</span>
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-gray-400">{eInvoiceInfo.validatorDetail}</p>

              {/* Offizielle KoSIT-Prüfung, auf Knopfdruck (Stefan 2026-08-26) —
                  ergänzt die interne Prüfung oben um die rechtsverbindliche
                  Schema-/Schematron-Konformitätsprüfung. Nur bei echter
                  E-Rechnung sinnvoll, dauert ein paar Sekunden (Java-Start). */}
              {isEInvoice && (
                <div className="mt-3 border-t border-[var(--line)] pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold uppercase tracking-wide text-gray-400">KoSIT-Prüfung (offiziell)</p>
                    <button type="button" className="btn-secondary !px-2 !py-1 text-[11px]" onClick={runKositCheck} disabled={kositBusy}>
                      {kositBusy ? 'Prüfe …' : kositResult || kositError ? 'Erneut prüfen' : 'Jetzt prüfen'}
                    </button>
                  </div>
                  {/* Stefan 2026-08-26: läuft jetzt automatisch im Hintergrund
                      direkt nach Ablage — Zeitstempel macht sichtbar, dass das
                      Ergebnis unten nicht erst durch einen Klick entstanden ist. */}
                  {invoice.kositCheckedAt && !kositBusy && (
                    <p className="mt-1 text-[10px] text-gray-400">
                      Automatisch geprüft am {new Date(invoice.kositCheckedAt).toLocaleString('de-DE')}
                    </p>
                  )}
                  {kositError && <p className="mt-2 text-[var(--danger)]">{kositError}</p>}
                  {kositResult && (
                    <div className="mt-2 space-y-1.5">
                      <p className={`font-semibold ${
                        kositResult.accepted === true ? 'text-[var(--accent)]'
                          : kositResult.accepted === false ? 'text-[var(--danger)]'
                            : 'text-[var(--warn-strong)]'
                      }`}>
                        {kositResult.accepted === true ? '✓ Akzeptabel' : kositResult.accepted === false ? '⛔ Zurückgewiesen' : '? Ergebnis unklar'}
                        {kositResult.scenarioName ? ` — ${kositResult.scenarioName}` : ''}
                      </p>
                      {/* Stefan 2026-08-26 ("Zurückgewiesen und keine Beanstandungen"):
                          eine leere Meldungsliste bei "nicht akzeptiert" NIE als
                          "Keine Beanstandungen" zeigen — das klingt positiv, ist
                          hier aber das Gegenteil. Meist bedeutet es, dass gar
                          kein Szenario erkannt wurde (das Dokument entspricht
                          keinem der bekannten Formate). */}
                      {kositResult.messages.length === 0 ? (
                        <p className="text-gray-500">
                          {kositResult.accepted !== true
                            ? kositResult.scenarioName === null
                              ? 'Kein passendes E-Rechnungs-Szenario erkannt — das Dokument entspricht keinem der bekannten XRechnung-/EN16931-Formate.'
                              : 'Zurückgewiesen, aber keine Einzelmeldungen im Bericht gefunden — bitte das Dokument prüfen.'
                            : 'Keine Beanstandungen.'}
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {kositResult.messages.map((m, i) => (
                            <li key={i} className={
                              m.level === 'error' || m.level === 'fatal' ? 'text-[var(--danger)]'
                                : m.level === 'warning' ? 'text-[var(--warn-strong)]'
                                  : 'text-gray-500'
                            }>
                              {m.code ? `[${m.code}] ` : ''}{m.text}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <ul className="mt-3 space-y-2.5">
              {checks.map((c) => (
                <li key={c.label} className="flex items-start gap-2 text-sm">
                  <span className={`shrink-0 font-bold ${CHECK_STATUS_STYLE[c.status].className}`}>{CHECK_STATUS_STYLE[c.status].icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-gray-700">{c.label}</span>
                    <span className="block text-xs text-gray-500">{c.detail}</span>
                    {/* Einzelposten der Pflichtangaben-Prüfung (Stefan 2026-08-26) —
                        jede Regel aus validateData() einzeln statt nur der Summe. */}
                    {c.subItems && c.subItems.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 border-l border-[var(--line)] pl-2.5">
                        {c.subItems.map((s) => (
                          <li key={s.label} className={`flex items-center gap-1.5 text-[11px] ${s.ok ? 'text-gray-500' : 'text-[var(--danger)]'}`}>
                            <span className="font-bold">{s.ok ? '✓' : '✗'}</span>
                            {s.label}
                          </li>
                        ))}
                      </ul>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end">
              <button type="button" className="btn-secondary" onClick={() => setShowReport(false)}>Schließen</button>
            </div>
          </div>
        </div>
      )}

      <div className="dp-card space-y-2.5">
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
        {invoice.duplicateOfId && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2">
            <p className="text-xs font-semibold text-[var(--warn-strong)]">
              Als Dublette erkannt —{' '}
              <a className="underline" href={`/invoices/${invoice.duplicateOfId}`}>Original öffnen</a>
            </p>
            <div className="flex gap-1.5">
              <button type="button" className="btn-secondary !px-2 !py-1 text-xs" onClick={unmarkDuplicate} disabled={busy}
                title="Dubletten-Markierung aufheben — diese Rechnung wird als eigenständig behandelt">
                Keine Dublette
              </button>
              <button type="button" className="btn-danger !px-2 !py-1 text-xs" onClick={remove} disabled={busy}
                title="Diese (doppelte) Rechnung löschen — landet im Papierkorb, kann von dort wiederhergestellt werden">
                Löschen
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Weitere Angaben (Stefan 2026-08-25): alles Gelegentliche gebündelt und
          zurückhaltender dargestellt als das Tagesgeschäft oben — KI-Werkzeuge,
          Tags, Notizen, Korrektur anfordern (Kontierung/Zahlungsart stehen
          bewusst NICHT hier, siehe oben). Standardmäßig aufgeklappt (nichts
          wird versteckt), aber sichtbar zweitrangig. */}
      <details className="group dp-card open:pb-4" open>
        <summary className="-mx-1 flex cursor-pointer list-none items-center gap-2 rounded-lg px-1 py-0.5 text-xs font-bold uppercase tracking-wide text-gray-500 hover:text-gray-700">
          <span className="inline-block transition-transform group-open:rotate-90">▸</span>
          Weitere Angaben
        </summary>
        <div className="mt-3 space-y-4 border-t border-[var(--line)] pt-3">
          {(canUseAi || canCompareXml) && aiAvailable && (
            <p className="text-[11px] text-gray-400">
              ⚠ KI-generierte oder -verarbeitete Inhalte können fehlerhaft sein — bitte vor der
              Übernahme immer gegenprüfen.
            </p>
          )}
          {canUseAi && aiAvailable && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2">
              <button type="button" className="btn-secondary" onClick={fillWithAi} disabled={aiBusy}
                title="Beleg per KI auslesen und Felder in der Kopfzeile oben vorschlagen — Ergebnis bitte immer gegenprüfen">
                {aiBusy ? 'KI liest die Rechnung …' : '✨ Mit KI erkennen'}
              </button>
              <p className="text-[11px] text-gray-500">
                Liest den Beleg nachträglich per KI aus und befüllt die Felder oben (auch
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tags" value={f.tags} onChange={(v) => set('tags', v)} />
          </div>
          <div>
            <label className="dp-label" title="Interne Notiz, Kontierung oder ergänzende Information — nicht Teil der Rechnung selbst, immer frei editierbar">
              Notizen (z. B. Kontierung, interne Vermerke)
            </label>
            <textarea className="dp-input mt-1" rows={3} value={f.notes}
              title="Interne Notiz, Kontierung oder ergänzende Information — nicht Teil der Rechnung selbst, immer frei editierbar"
              onChange={(e) => set('notes', e.target.value)} />
          </div>
        </div>
      </details>

      </fieldset>
    </form>
  )
}

function CheckChip({
  letter, done, notApplicable, title, disabled, onToggle,
}: {
  letter: string; done: boolean; notApplicable?: boolean; title: string; disabled?: boolean; onToggle: () => void
}) {
  const base = 'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold border transition-colors'
  // Stefan 2026-08-26: Prüfkette grün statt in der (blauen) Akzentfarbe —
  // dieselbe Farbgebung wie CheckBadges.tsx in der Rechnungsliste, damit
  // beide Stellen einheitlich aussehen. "Entfällt" bekommt dieselbe positive
  // Farbe wie "erledigt" (nur mit "–" statt Haken), "offen" bleibt neutral grau.
  if (notApplicable) {
    return <span className={`${base} border-green-600 bg-green-600 text-white`} title={title}>–</span>
  }
  return (
    <button type="button" disabled={disabled} onClick={onToggle} title={title}
      className={`${base} ${
        done ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 bg-white text-gray-400'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:opacity-80'}`}>
      {done ? '✓' : letter}
    </button>
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
