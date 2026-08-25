// E-Rechnung (W17): Erkennung, Datenextraktion und Pflichtfeld-Prüfung.
// Formate: ZUGFeRD/Factur-X (PDF mit eingebettetem CII-XML), XRechnung (reines
// XML, Syntax UBL oder UN/CEFACT CII), normales PDF.
// Prüfung: formale Kernfeld-Prüfung nach EN 16931 / §14 UStG (Rechnungsnummer,
// Datum, Verkäufer + USt-ID/Steuernummer, Käufer, Beträge, Währung).
// Vollständige Schematron-/KoSIT-Validierung ist als Ausbaustufe vorgesehen.
import { XMLParser } from 'fast-xml-parser'
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
} from 'pdf-lib'
import { EINVOICE_FORMATS, FORMAT_LABELS, type DocFormat } from '@/lib/docFormat'

export type { DocFormat }
export { EINVOICE_FORMATS, FORMAT_LABELS }

export type InvoiceLine = {
  name: string
  quantity: string | null
  lineTotal: number | null
  // Positions-Rabatt (Summe evtl. mehrerer Nachlässe auf dieser Position),
  // best-effort aus SpecifiedTradeAllowanceCharge (CII) / AllowanceCharge
  // (UBL) mit Indikator "Abzug" gelesen — null wenn keiner angegeben.
  discount: number | null
}

// Ein Steuersatz-Eintrag ("Steuerprozent") der Rechnung — EN 16931 verlangt
// den Steuersatz je Kategorie, nicht nur den Gesamt-Steuerbetrag (Stefan
// 2026-08-25). Meist genau ein Eintrag (z. B. 19%), bei gemischten
// Steuersätzen mehrere.
export type TaxRate = { ratePercent: number | null; taxableAmount: number | null; taxAmount: number | null }

export type ParsedInvoiceData = {
  number: string | null
  issueDate: string | null // ISO yyyy-mm-dd
  dueDate: string | null
  deliveryDate: string | null // ISO yyyy-mm-dd, best-effort (Lieferdatum)
  // Abrechnungszeitraum/Leistungszeitraum (Stefan 2026-08-25) — Alternative
  // zu einem einzelnen Lieferdatum bei periodischen Leistungen (z. B.
  // Wartungsverträge, Abos): EN 16931 BG-14 verlangt EINES von beiden.
  deliveryPeriodStart: string | null
  deliveryPeriodEnd: string | null
  sellerName: string | null
  sellerVatId: string | null
  buyerName: string | null
  net: number | null
  tax: number | null
  gross: number | null
  currency: string | null
  paymentTerms: string | null // Freitext-Zahlungsbedingung, falls im XML angegeben
  // Skonto (Stefan 2026-08-25) — eigenes Fälligkeitsdatum + Prozentsatz für
  // vorzeitige Zahlung, getrennt vom eigentlichen Zahlungsziel oben (dueDate
  // ist bewusst IMMER die Netto-Frist, siehe Bugfix-Kommentar bei parseCii).
  // Nur bei CII strukturiert auslesbar (ApplicableTradePaymentDiscountTerms)
  // — UBL/EN16931-Kernmodell kennt dafür kein eigenes Feld, dort nur
  // Freitext in paymentTerms, falls der Lieferant es dort erwähnt.
  discountDueDate: string | null
  discountPercent: number | null
  // Steuersätze (Stefan 2026-08-25) — siehe TaxRate oben, EN 16931-Pflichtangabe.
  taxRates: TaxRate[]
  // Rabatt/Zuschlag auf RECHNUNGSEBENE (nicht je Position, Stefan 2026-08-25)
  // — z. B. "5 % Rabatt auf die Gesamtsumme". Bisher unsichtbar: die
  // Gesamtsummen (net/tax/gross) stammen zwar korrekt aus dem XML (bereits
  // rabattiert), aber ohne diesen Wert war für einen Menschen nicht
  // nachvollziehbar, warum die Summe der Positionen nicht zur Netto-Summe passt.
  documentAllowance: number | null
  lines: InvoiceLine[]
}

export type Validation = { valid: boolean; missing: string[] }

export type Analysis = {
  format: DocFormat
  xml: string | null
  data: ParsedInvoiceData | null
  validation: Validation | null
}

// ── Helfer ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any

function val(x: Node): string | null {
  if (x === undefined || x === null) return null
  if (typeof x === 'object') return x['#text'] !== undefined ? String(x['#text']) : null
  return String(x)
}

function num(x: Node): number | null {
  const s = val(x)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function first(x: Node): Node {
  return Array.isArray(x) ? x[0] : x
}

function asArray(x: Node): Node[] {
  if (x === undefined || x === null) return []
  return Array.isArray(x) ? x : [x]
}

/** Format 102 (YYYYMMDD) oder ISO → ISO-Datum. */
function toIsoDate(x: Node): string | null {
  const s = val(x)
  if (!s) return null
  const clean = s.trim()
  if (/^\d{8}$/.test(clean)) return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) return clean.slice(0, 10)
  return null
}

/**
 * Rabatt-Summe aus AllowanceCharge (UBL) / SpecifiedTradeAllowanceCharge (CII)
 * lesen — nur Einträge mit ChargeIndicator "false" (= Abzug/Rabatt) werden
 * gezählt, "true" (Zuschlag) wird ignoriert. Best-effort/optional, daher kein
 * Pflichtfeld irgendwo — null wenn keine Angabe vorhanden.
 */
function sumDiscount(allowances: Node, amountKey: string): number | null {
  let sum = 0
  let found = false
  for (const a of asArray(allowances)) {
    const indicatorRaw = val(a?.ChargeIndicator?.Indicator) ?? val(a?.ChargeIndicator)
    if (indicatorRaw === 'true' || indicatorRaw === '1') continue // Zuschlag, kein Rabatt
    const amount = num(a?.[amountKey])
    if (amount !== null) {
      sum += amount
      found = true
    }
  }
  return found ? sum : null
}

// ── CII (ZUGFeRD / XRechnung-CII) ──
function parseCii(root: Node): ParsedInvoiceData {
  const doc = root?.ExchangedDocument
  const tx = root?.SupplyChainTradeTransaction
  const agreement = tx?.ApplicableHeaderTradeAgreement
  const settlement = tx?.ApplicableHeaderTradeSettlement
  const sum = settlement?.SpecifiedTradeSettlementHeaderMonetarySummation
  const seller = agreement?.SellerTradeParty
  const vat = asArray(seller?.SpecifiedTaxRegistration)
    .map((r: Node) => val(r?.ID))
    .find(Boolean)

  // Zahlungsziel (Stefan 2026-08-25, Bugfix): eine Rechnung kann MEHRERE
  // SpecifiedTradePaymentTerms-Blöcke haben (z. B. einen für "2 % Skonto
  // innerhalb 7 Tagen" UND einen für "netto innerhalb 30 Tagen") — bisher
  // wurde per first() blind der ERSTE genommen, was bei dieser (üblichen)
  // Reihenfolge das kürzere Skonto-Fälligkeitsdatum statt des eigentlichen
  // Zahlungsziels lieferte. Jetzt: den Block OHNE Skonto-Bedingung
  // bevorzugen (das eigentliche Zahlungsziel), sonst den ersten mit einem
  // Fälligkeitsdatum.
  const paymentTermsBlocks = asArray(settlement?.SpecifiedTradePaymentTerms)
  const paymentTerms =
    paymentTermsBlocks.find((p: Node) => !p?.ApplicableTradePaymentDiscountTerms && p?.DueDateDateTime) ??
    paymentTermsBlocks.find((p: Node) => p?.DueDateDateTime) ??
    first(paymentTermsBlocks)

  // Skonto (Stefan 2026-08-25): eigener Block MIT ApplicableTradePaymentDiscountTerms
  // — das Fälligkeitsdatum DIESES Blocks ist die Skonto-Frist (kürzer als das
  // oben ermittelte eigentliche Zahlungsziel), CalculationPercent der Satz.
  const discountBlock = paymentTermsBlocks.find((p: Node) => p?.ApplicableTradePaymentDiscountTerms)
  const discountTerms = discountBlock?.ApplicableTradePaymentDiscountTerms
  const discountDueDate = toIsoDate(discountBlock?.DueDateDateTime?.DateTimeString)
  const discountPercent = num(discountTerms?.CalculationPercent)

  const lines: InvoiceLine[] = asArray(tx?.IncludedSupplyChainTradeLineItem).map((li: Node) => ({
    name: val(li?.SpecifiedTradeProduct?.Name) ?? '—',
    quantity: val(li?.SpecifiedLineTradeDelivery?.BilledQuantity),
    lineTotal: num(li?.SpecifiedLineTradeSettlement?.SpecifiedTradeSettlementLineMonetarySummation?.LineTotalAmount),
    discount: sumDiscount(li?.SpecifiedLineTradeSettlement?.SpecifiedTradeAllowanceCharge, 'ActualAmount'),
  }))

  const taxRates: TaxRate[] = asArray(settlement?.ApplicableTradeTax).map((t: Node) => ({
    ratePercent: num(t?.RateApplicablePercent),
    taxableAmount: num(t?.BasisAmount),
    taxAmount: num(t?.CalculatedAmount),
  }))

  const period = settlement?.BillingSpecifiedPeriod

  return {
    number: val(doc?.ID),
    issueDate: toIsoDate(doc?.IssueDateTime?.DateTimeString),
    dueDate: toIsoDate(paymentTerms?.DueDateDateTime?.DateTimeString),
    deliveryDate: toIsoDate(tx?.ApplicableHeaderTradeDelivery?.ActualDeliverySupplyChainEvent?.OccurrenceDateTime?.DateTimeString),
    deliveryPeriodStart: toIsoDate(period?.StartDateTime?.DateTimeString),
    deliveryPeriodEnd: toIsoDate(period?.EndDateTime?.DateTimeString),
    sellerName: val(seller?.Name),
    sellerVatId: vat ?? null,
    buyerName: val(agreement?.BuyerTradeParty?.Name),
    net: num(sum?.TaxBasisTotalAmount),
    tax: num(first(sum?.TaxTotalAmount)),
    gross: num(sum?.GrandTotalAmount),
    currency: val(settlement?.InvoiceCurrencyCode),
    paymentTerms: val(paymentTerms?.Description),
    discountDueDate,
    discountPercent,
    taxRates,
    documentAllowance: sumDiscount(settlement?.SpecifiedTradeAllowanceCharge, 'ActualAmount'),
    lines,
  }
}

// ── UBL (XRechnung-UBL) ──
function parseUbl(inv: Node): ParsedInvoiceData {
  const supplier = inv?.AccountingSupplierParty?.Party
  const customer = inv?.AccountingCustomerParty?.Party
  const totals = inv?.LegalMonetaryTotal
  const sellerName =
    val(supplier?.PartyLegalEntity?.RegistrationName) ?? val(first(supplier?.PartyName)?.Name)
  const buyerName =
    val(customer?.PartyLegalEntity?.RegistrationName) ?? val(first(customer?.PartyName)?.Name)
  const vat = asArray(supplier?.PartyTaxScheme)
    .map((r: Node) => val(r?.CompanyID))
    .find(Boolean)

  const lines: InvoiceLine[] = asArray(inv?.InvoiceLine).map((li: Node) => ({
    name: val(li?.Item?.Name) ?? val(li?.Item?.Description) ?? '—',
    quantity: val(li?.InvoicedQuantity),
    lineTotal: num(li?.LineExtensionAmount),
    discount: sumDiscount(li?.AllowanceCharge, 'Amount'),
  }))

  const taxSubtotals = asArray(first(inv?.TaxTotal)?.TaxSubtotal)
  const taxRates: TaxRate[] = taxSubtotals.map((t: Node) => ({
    ratePercent: num(t?.TaxCategory?.Percent),
    taxableAmount: num(t?.TaxableAmount),
    taxAmount: num(t?.TaxAmount),
  }))

  const period = first(inv?.InvoicePeriod)

  return {
    number: val(inv?.ID),
    issueDate: toIsoDate(inv?.IssueDate),
    dueDate: toIsoDate(inv?.DueDate),
    deliveryDate: toIsoDate(first(inv?.Delivery)?.ActualDeliveryDate),
    deliveryPeriodStart: toIsoDate(period?.StartDate),
    deliveryPeriodEnd: toIsoDate(period?.EndDate),
    sellerName,
    sellerVatId: vat ?? null,
    buyerName,
    net: num(totals?.TaxExclusiveAmount),
    tax: num(first(inv?.TaxTotal)?.TaxAmount),
    gross: num(totals?.TaxInclusiveAmount) ?? num(totals?.PayableAmount),
    currency: val(inv?.DocumentCurrencyCode),
    paymentTerms: val(first(inv?.PaymentTerms)?.Note),
    // UBL/EN16931-Kernmodell hat kein strukturiertes Skonto-Feld — siehe
    // Kommentar bei ParsedInvoiceData oben.
    discountDueDate: null,
    discountPercent: null,
    taxRates,
    documentAllowance: sumDiscount(inv?.AllowanceCharge, 'Amount'),
    lines,
  }
}

/**
 * Pflichtangaben-Prüfung (EN 16931-Kern / §14 Abs. 4 UStG, formale Ebene).
 * Stefan 2026-08-25: um zwei bisher fehlende, aber gesetzlich zwingende
 * Angaben ergänzt — Liefer-/Leistungsdatum (§14 Abs. 4 Nr. 6 UStG, BT-72,
 * ODER alternativ ein Leistungszeitraum, BG-14/BT-73+BT-74) und der
 * Steuersatz je Position/Kategorie (§14 Abs. 4 Nr. 8 UStG, BT-119/BT-152 —
 * vorher wurde nur der SUMMIERTE Steuerbetrag geprüft, nicht der Prozentsatz
 * selbst). Diese Rechnungen dürfen laut Vorgabe erst nach Behebung an die
 * Buchhaltung übergeben werden — validationOk fließt über
 * autoElectronicCheck in die "Elektronische Vorprüfung" ein, die wiederum
 * Voraussetzung für "An Buchhaltung übergeben" ist (siehe api/invoices/[id]/route.ts).
 */
export function validateData(d: ParsedInvoiceData): Validation {
  const missing: string[] = []
  if (!d.number) missing.push('Rechnungsnummer')
  if (!d.issueDate) missing.push('Rechnungsdatum')
  if (!d.sellerName) missing.push('Name des Rechnungsstellers')
  if (!d.sellerVatId) missing.push('USt-ID/Steuernummer des Rechnungsstellers')
  if (!d.buyerName) missing.push('Name des Rechnungsempfängers')
  if (d.net === null) missing.push('Nettobetrag')
  if (d.tax === null) missing.push('Steuerbetrag')
  if (d.gross === null) missing.push('Bruttobetrag')
  if (!d.currency) missing.push('Währung')
  if (!d.deliveryDate && !(d.deliveryPeriodStart && d.deliveryPeriodEnd)) {
    missing.push('Liefer-/Leistungsdatum oder Abrechnungszeitraum')
  }
  if (d.taxRates.length === 0 || d.taxRates.every((t) => t.ratePercent === null)) {
    missing.push('Steuersatz')
  }
  return { valid: missing.length === 0, missing }
}

/**
 * Elektronische Vorprüfung (Stefan 2026-08-25): bei einer strukturierten,
 * GÜLTIGEN E-Rechnung hat das System schon maschinell geprüft — automatisch
 * erledigt. Bei einer NICHT-E-Rechnung (nackte PDF, Scan/Foto, aus
 * Dokumenten-Text rekonstruiert) ist diese Prüfung gar nicht anwendbar (kein
 * XML zum Prüfen vorhanden) — "entfällt" statt eines offenen, aber sinnlosen
 * Häkchens, das sonst nie jemand sinnvoll abhaken könnte. Nur bei einer
 * strukturierten, aber UNGÜLTIGEN E-Rechnung bleibt es offen (dort besteht
 * echter Prüfbedarf: fehlende Pflichtangaben). checkElectronicBy beginnt in
 * diesem Fall bewusst mit "System (entfällt" — daran erkennt die UI
 * (CheckBadges.tsx/InvoiceEditForm.tsx) den Unterschied zu einer echten
 * bestandenen Prüfung.
 */
export function autoElectronicCheck(
  format: DocFormat,
  validationValid: boolean | undefined,
): { at: Date | null; by: string | null } {
  const isStructured = (EINVOICE_FORMATS as string[]).includes(format)
  if (isStructured && validationValid === true) {
    return { at: new Date(), by: `System (automatisch: ${FORMAT_LABELS[format]}, Pflichtangaben vollständig)` }
  }
  if (!isStructured) {
    return { at: new Date(), by: 'System (entfällt — kein E-Rechnungs-Format)' }
  }
  return { at: null, by: null }
}

/**
 * Firmenbezeichnung normalisieren für den Abgleich (Stefan 2026-08-25) —
 * unempfindlich gegen Groß-/Kleinschreibung, doppelte Leerzeichen und
 * Satzzeichen (Punkt/Komma), damit triviale Schreibvarianten ("Demo GmbH"
 * vs. "Demo GmbH.") keine Fehlalarme auslösen — bewusst KEIN unscharfer
 * Abgleich (Levenshtein o. Ä.), da eine tatsächlich abweichende Firma genau
 * das ist, was die Warnung zeigen soll.
 */
function normalizeCompanyName(s: string): string {
  return s.toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Prüft, ob der Rechnungsempfänger (buyerName aus der E-Rechnung) von der
 * hinterlegten exakten Firmenbezeichnung des Mandanten abweicht (Stefan
 * 2026-08-25) — z. B. bei einer versehentlich falsch adressierten Rechnung.
 * `null`/leer bei einer der beiden Seiten → keine Aussage möglich, kein Fehlalarm.
 */
export function buyerNameMismatch(tenantLegalName: string | null, buyerName: string | null): boolean {
  if (!tenantLegalName?.trim() || !buyerName?.trim()) return false
  return normalizeCompanyName(tenantLegalName) !== normalizeCompanyName(buyerName)
}

/** XML-Rechnung parsen (Syntax-Erkennung UBL vs. CII). */
export function parseInvoiceXml(xml: string): { format: DocFormat; data: ParsedInvoiceData } | null {
  try {
    const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true })
    const obj = parser.parse(xml)
    if (obj?.CrossIndustryInvoice) {
      return { format: 'XRECHNUNG_CII', data: parseCii(obj.CrossIndustryInvoice) }
    }
    if (obj?.Invoice) {
      return { format: 'XRECHNUNG_UBL', data: parseUbl(obj.Invoice) }
    }
    return null
  } catch {
    return null
  }
}

/** ZUGFeRD/Factur-X: eingebettetes XML aus dem PDF extrahieren. */
async function extractEmbeddedXml(buffer: Buffer): Promise<string | null> {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false })
    const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
    const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
    const arr = embedded?.lookupMaybe(PDFName.of('Names'), PDFArray)
    if (!arr) return null
    for (let i = 0; i + 1 < arr.size(); i += 2) {
      const nameObj = arr.lookup(i)
      const fileName =
        nameObj instanceof PDFString || nameObj instanceof PDFHexString ? nameObj.decodeText() : ''
      if (!/\.xml$/i.test(fileName)) continue
      const spec = arr.lookupMaybe(i + 1, PDFDict)
      const ef = spec?.lookupMaybe(PDFName.of('EF'), PDFDict)
      const fObj = ef ? (ef.lookup(PDFName.of('F')) ?? ef.lookup(PDFName.of('UF'))) : undefined
      if (!(fObj instanceof PDFRawStream)) continue
      const bytes = decodePDFRawStream(fObj).decode()
      return Buffer.from(bytes).toString('utf8')
    }
    return null
  } catch {
    return null
  }
}

/** Zentrale Analyse einer eingehenden Datei (E-Mail, Upload, Plugin — unverschlüsselt). */
export async function analyzeInvoiceFile(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<Analysis> {
  const isXml =
    mimeType === 'application/xml' || mimeType === 'text/xml' || /\.xml$/i.test(fileName)
  if (isXml) {
    const xml = buffer.toString('utf8')
    const parsed = parseInvoiceXml(xml)
    if (parsed) {
      return { format: parsed.format, xml, data: parsed.data, validation: validateData(parsed.data) }
    }
    return { format: 'OTHER', xml, data: null, validation: null }
  }
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(fileName)) {
    const xml = await extractEmbeddedXml(buffer)
    if (xml) {
      const parsed = parseInvoiceXml(xml)
      if (parsed) {
        return { format: 'ZUGFERD', xml, data: parsed.data, validation: validateData(parsed.data) }
      }
    }
    return { format: 'PDF', xml: null, data: null, validation: null }
  }
  return { format: 'OTHER', xml: null, data: null, validation: null }
}
