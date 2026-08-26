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
// 2026-08-25). Kann MEHRFACH vorkommen (z. B. 19% + 7% gemischt auf einer
// Rechnung) — deshalb ein Array, nicht ein einzelner Wert.
export type TaxRate = {
  ratePercent: number | null
  taxableAmount: number | null
  taxAmount: number | null
  // Kategorie-Code (Stefan 2026-08-25, EN 16931 BT-118/UNTDID 5305) — u. a.
  // "S" Normalsatz, "Z" Nullsatz, "E" steuerbefreit, "G"/"K" Ausfuhr/
  // innergemeinschaftlich, "O" nicht steuerbar (z. B. Drittland-Reverse-Charge).
  categoryCode: string | null
  // Pflichtangabe bei Steuersatz 0 % bzw. Befreiung (§14 Abs. 4 Nr. 8 UStG,
  // EN 16931 BT-120/BT-121) — z. B. "Steuerfreie Ausfuhrlieferung (Drittland,
  // § 4 Nr. 1a UStG)". Ohne diesen Hinweis ist eine 0 %-Rechnung formal
  // unvollständig, nicht einfach "keine Steuer angegeben".
  exemptionReason: string | null
}

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
  // Anschrift (Stefan 2026-08-25, §14 Abs. 4 Nr. 1 UStG) — "vollständiger
  // Name UND ANSCHRIFT" ist eine eigene Pflichtangabe, bisher fehlte die
  // Anschrift komplett. Best-effort zu einer Zeile zusammengefasst
  // (Straße, PLZ Ort, Land) statt einzelner Adressfelder — für die reine
  // Vollständigkeitsprüfung reicht das.
  sellerAddress: string | null
  buyerAddress: string | null
  // USt-IdNr. UND Steuernummer getrennt (Stefan 2026-08-25, Bugfix): §14
  // Abs. 4 Nr. 2 UStG verlangt EINES von beiden, nicht zwingend die USt-IdNr.
  // — vorher wurde nur EIN Wert übernommen (der erste gefundene
  // SpecifiedTaxRegistration-Eintrag), ohne zwischen den beiden inhaltlich
  // unterschiedlichen Kennungen zu unterscheiden (schemeID "VA" = USt-IdNr.,
  // "FC" = Steuernummer/Fiscal Code bei CII; UBL: TaxScheme-ID "VAT" vs.
  // andere). Das führte dazu, dass eine reine Steuernummer OHNE USt-IdNr.
  // in der Anzeige/Prüfung wie eine USt-IdNr. aussah.
  sellerVatId: string | null
  sellerTaxNumber: string | null
  // Land des Lieferanten (Stefan 2026-08-25, ISO 3166-1 alpha-2) — bei
  // E-Rechnung aus der strukturierten Anschrift (CountryID), bei PDF/KI aus
  // der KI-Erkennung. Grundlage für die Inland/EU/Drittland-Einordnung, die
  // wiederum bestimmt, welche Pflichtangaben-Regel gilt (siehe classifyTaxRegion).
  sellerCountryCode: string | null
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

// `checks` (Stefan 2026-08-26): dieselben Pflichtangaben-Regeln wie `missing`,
// aber JEDE einzeln mit ok/fehlt statt nur der Sammel-Liste — Grundlage für
// den detaillierten Prüfbericht (InvoiceEditForm.tsx), ohne die Regeln ein
// zweites Mal an anderer Stelle nachzubauen. `missing`/`valid` bleiben aus
// Kompatibilitätsgründen (bestehende Aufrufer) zusätzlich vorhanden.
export type Validation = { valid: boolean; missing: string[]; checks: { label: string; ok: boolean }[] }

// Inland/EU/Drittland-Einordnung (Stefan 2026-08-25) — best-effort anhand des
// Länder-Codes des Lieferanten, NICHT als verbindliche Steuerrechts-Auskunft
// zu verstehen (Grenzfälle wie Sonderzonen, Nordirland-Protokoll etc. werden
// bewusst nicht abgebildet) — dient nur dazu, die Pflichtangaben-Prüfung
// unten realistischer zu machen, mit Möglichkeit zur manuellen Korrektur.
export type TaxRegion = 'INLAND' | 'EU' | 'DRITTLAND'
const EU_COUNTRY_CODES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
] // ohne DE — das ist gesondert INLAND

export function classifyTaxRegion(countryCode: string | null): TaxRegion | null {
  if (!countryCode) return null
  const cc = countryCode.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return null
  if (cc === 'DE') return 'INLAND'
  return EU_COUNTRY_CODES.includes(cc) ? 'EU' : 'DRITTLAND'
}

export const TAX_REGION_LABELS: Record<TaxRegion, string> = {
  INLAND: 'Inland (Deutschland)',
  EU: 'EU-Ausland',
  DRITTLAND: 'Drittland',
}

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

/** CII PostalTradeAddress zu einer Anschriftszeile zusammengefasst (Stefan 2026-08-25). */
function ciiAddress(party: Node): string | null {
  const addr = party?.PostalTradeAddress
  if (!addr) return null
  const parts = [val(addr?.LineOne), val(addr?.LineTwo)].filter(Boolean) as string[]
  const cityLine = [val(addr?.PostcodeCode), val(addr?.CityName)].filter(Boolean).join(' ')
  if (cityLine) parts.push(cityLine)
  const country = val(addr?.CountryID)
  if (country) parts.push(country)
  return parts.length > 0 ? parts.join(', ') : null
}

/** CII Länder-Code (ISO 3166-1 alpha-2) getrennt von der Anschriftszeile (Stefan 2026-08-25). */
function ciiCountry(party: Node): string | null {
  return val(party?.PostalTradeAddress?.CountryID)
}

/** UBL PostalAddress zu einer Anschriftszeile zusammengefasst (Stefan 2026-08-25). */
function ublAddress(party: Node): string | null {
  const addr = party?.PostalAddress
  if (!addr) return null
  const parts = [val(addr?.StreetName), val(addr?.AdditionalStreetName)].filter(Boolean) as string[]
  const cityLine = [val(addr?.PostalZone), val(addr?.CityName)].filter(Boolean).join(' ')
  if (cityLine) parts.push(cityLine)
  const country = val(addr?.Country?.IdentificationCode)
  if (country) parts.push(country)
  return parts.length > 0 ? parts.join(', ') : null
}

/** UBL Länder-Code (ISO 3166-1 alpha-2) getrennt von der Anschriftszeile (Stefan 2026-08-25). */
function ublCountry(party: Node): string | null {
  return val(party?.PostalAddress?.Country?.IdentificationCode)
}

/**
 * USt-IdNr. und Steuernummer GETRENNT aus den SpecifiedTaxRegistration-
 * Einträgen lesen (Stefan 2026-08-25, Bugfix) — unterschieden über das
 * schemeID-Attribut ("VA" = USt-IdNr., "FC" = Steuernummer/Fiscal Code).
 * Ohne erkennbares schemeID: als USt-IdNr. behandelt (bisheriges Verhalten
 * als Fallback beibehalten, für nicht EN16931-konforme Exporte).
 */
function ciiTaxIds(registrations: Node): { vatId: string | null; taxNumber: string | null } {
  const regs = asArray(registrations)
  const vatEntry = regs.find((r: Node) => r?.ID?.['@_schemeID'] === 'VA')
  const fcEntry = regs.find((r: Node) => r?.ID?.['@_schemeID'] === 'FC')
  const fallback = regs.find((r: Node) => val(r?.ID))
  return {
    vatId: val(vatEntry?.ID) ?? (fcEntry ? null : val(fallback?.ID)),
    taxNumber: val(fcEntry?.ID),
  }
}

// ── CII (ZUGFeRD / XRechnung-CII) ──
function parseCii(root: Node): ParsedInvoiceData {
  const doc = root?.ExchangedDocument
  const tx = root?.SupplyChainTradeTransaction
  const agreement = tx?.ApplicableHeaderTradeAgreement
  const settlement = tx?.ApplicableHeaderTradeSettlement
  const sum = settlement?.SpecifiedTradeSettlementHeaderMonetarySummation
  const seller = agreement?.SellerTradeParty
  const buyer = agreement?.BuyerTradeParty
  const { vatId, taxNumber } = ciiTaxIds(seller?.SpecifiedTaxRegistration)

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
    categoryCode: val(t?.CategoryCode),
    exemptionReason: val(t?.ExemptionReason),
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
    sellerAddress: ciiAddress(seller),
    buyerAddress: ciiAddress(buyer),
    sellerVatId: vatId,
    sellerTaxNumber: taxNumber,
    sellerCountryCode: ciiCountry(seller),
    buyerName: val(buyer?.Name),
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
  // USt-IdNr. vs. Steuernummer (Stefan 2026-08-25, analog CII oben) —
  // unterschieden über TaxScheme.ID: "VAT" = USt-IdNr., alles andere (z. B.
  // ein nationales Schema) als Steuernummer behandelt.
  const taxSchemes = asArray(supplier?.PartyTaxScheme)
  const vatScheme = taxSchemes.find((r: Node) => val(r?.TaxScheme?.ID) === 'VAT')
  const otherScheme = taxSchemes.find((r: Node) => val(r?.TaxScheme?.ID) && val(r?.TaxScheme?.ID) !== 'VAT')
  const fallbackScheme = taxSchemes.find((r: Node) => val(r?.CompanyID))
  const vat = val(vatScheme?.CompanyID) ?? (otherScheme ? null : val(fallbackScheme?.CompanyID))
  const taxNumber = val(otherScheme?.CompanyID)

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
    categoryCode: val(t?.TaxCategory?.ID),
    exemptionReason: val(t?.TaxCategory?.TaxExemptionReason),
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
    sellerAddress: ublAddress(supplier),
    buyerAddress: ublAddress(customer),
    sellerVatId: vat ?? null,
    sellerTaxNumber: taxNumber,
    sellerCountryCode: ublCountry(supplier),
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
export function validateData(
  d: ParsedInvoiceData,
  // Manuelle Überschreibung der Inland/EU/Drittland-Einordnung (Stefan
  // 2026-08-25, Invoice.taxRegion) — wenn gesetzt, hat sie Vorrang vor der
  // automatischen Ableitung aus d.sellerCountryCode (siehe page.tsx).
  regionOverride?: TaxRegion | null,
): Validation {
  const checks: { label: string; ok: boolean }[] = []
  const add = (label: string, ok: boolean) => checks.push({ label, ok })
  add('Rechnungsnummer', Boolean(d.number))
  add('Rechnungsdatum', Boolean(d.issueDate))
  add('Name des Rechnungsstellers', Boolean(d.sellerName))
  // §14 Abs. 4 Nr. 1 UStG: "vollständiger Name UND ANSCHRIFT" — bisher wurde
  // nur der Name geprüft, die Anschrift fehlte komplett (Stefan 2026-08-25).
  add('Anschrift des Rechnungsstellers', Boolean(d.sellerAddress))
  // §14 Abs. 4 Nr. 2 UStG: USt-IdNr. ODER Steuernummer genügt — beide getrennt
  // geprüft (Bugfix, vorher nur ein einzelnes, mehrdeutiges Feld). Jetzt
  // regionsabhängig (Stefan 2026-08-25, best-effort anhand sellerCountryCode):
  // bei EU-Lieferant wird gezielt die USt-IdNr. erwartet (innergem. Erwerb/
  // Reverse-Charge), bei Drittland-Lieferant wird gar nichts davon verlangt
  // (dort fehlt beides regelmäßig, ohne dass die Rechnung deshalb unvollständig
  // wäre) — ohne erkennbares Land bleibt es bei der bisherigen Inland-Regel
  // (eines von beiden genügt), um nichts fälschlich als vollständig durchzulassen.
  const region = regionOverride ?? classifyTaxRegion(d.sellerCountryCode)
  if (region === 'EU') {
    add('USt-IdNr. des Rechnungsstellers (EU-Lieferant)', Boolean(d.sellerVatId))
  } else if (region !== 'DRITTLAND') {
    add('USt-ID/Steuernummer des Rechnungsstellers', Boolean(d.sellerVatId || d.sellerTaxNumber))
  }
  add('Name des Rechnungsempfängers', Boolean(d.buyerName))
  add('Anschrift des Rechnungsempfängers', Boolean(d.buyerAddress))
  add('Nettobetrag', d.net !== null)
  add('Steuerbetrag', d.tax !== null)
  add('Bruttobetrag', d.gross !== null)
  add('Währung', Boolean(d.currency))
  add('Liefer-/Leistungsdatum oder Abrechnungszeitraum', Boolean(d.deliveryDate || (d.deliveryPeriodStart && d.deliveryPeriodEnd)))
  add('Steuersatz', d.taxRates.length > 0 && d.taxRates.some((t) => t.ratePercent !== null))
  // §14 Abs. 4 Nr. 8 UStG: bei Steuersatz 0 % (Drittland-Ausfuhr, innergem.
  // Lieferung, Reverse-Charge …) muss ein Hinweis auf die Steuerbefreiung
  // stehen — sonst sieht eine 0 %-Rechnung wie "keine Steuer angegeben" aus,
  // ist aber formal unvollständig (Stefan 2026-08-25). Nur relevant, wenn
  // überhaupt ein 0 %-Steuersatz vorkommt.
  if (d.taxRates.some((t) => t.ratePercent === 0)) {
    add('Hinweis auf Steuerbefreiung (bei 0 % Steuersatz)', d.taxRates.every((t) => t.ratePercent !== 0 || t.exemptionReason))
  }
  const missing = checks.filter((c) => !c.ok).map((c) => c.label)
  return { valid: missing.length === 0, missing, checks }
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
 * Formale Prüfung automatisch beim Mail-Eingang setzen (Stefan 2026-08-26):
 * bei einer strukturierten, GÜLTIGEN E-Rechnung ist mit vollständigen
 * Pflichtangaben auch die formale Prüfung erledigt — dieselbe Bedingung wie
 * bei autoElectronicCheck oben, kein zusätzlicher manueller Klick nötig.
 * Anders als dort KEIN "entfällt" für Nicht-E-Rechnungen: bei einer nackten
 * PDF/einem Scan bleibt "Formal richtig" ein echter, offener Prüfschritt
 * (durch einen Menschen oder — bei KI-Erfassung — durch die Bestätigung
 * aller Felder, siehe InvoiceEditForm.tsx save()).
 */
export function autoFormalCheckForEInvoice(
  format: DocFormat,
  validationValid: boolean | undefined,
): { at: Date | null; by: string | null } {
  const isStructured = (EINVOICE_FORMATS as string[]).includes(format)
  if (isStructured && validationValid === true) {
    return { at: new Date(), by: `System (automatisch: ${FORMAT_LABELS[format]}, Pflichtangaben vollständig)` }
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
