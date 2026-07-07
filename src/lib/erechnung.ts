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

export type DocFormat = 'ZUGFERD' | 'XRECHNUNG_CII' | 'XRECHNUNG_UBL' | 'PDF' | 'OTHER'

export type InvoiceLine = {
  name: string
  quantity: string | null
  lineTotal: number | null
}

export type ParsedInvoiceData = {
  number: string | null
  issueDate: string | null // ISO yyyy-mm-dd
  dueDate: string | null
  sellerName: string | null
  sellerVatId: string | null
  buyerName: string | null
  net: number | null
  tax: number | null
  gross: number | null
  currency: string | null
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

  const lines: InvoiceLine[] = asArray(tx?.IncludedSupplyChainTradeLineItem).map((li: Node) => ({
    name: val(li?.SpecifiedTradeProduct?.Name) ?? '—',
    quantity: val(li?.SpecifiedLineTradeDelivery?.BilledQuantity),
    lineTotal: num(li?.SpecifiedLineTradeSettlement?.SpecifiedTradeSettlementLineMonetarySummation?.LineTotalAmount),
  }))

  return {
    number: val(doc?.ID),
    issueDate: toIsoDate(doc?.IssueDateTime?.DateTimeString),
    dueDate: toIsoDate(first(settlement?.SpecifiedTradePaymentTerms)?.DueDateDateTime?.DateTimeString),
    sellerName: val(seller?.Name),
    sellerVatId: vat ?? null,
    buyerName: val(agreement?.BuyerTradeParty?.Name),
    net: num(sum?.TaxBasisTotalAmount),
    tax: num(first(sum?.TaxTotalAmount)),
    gross: num(sum?.GrandTotalAmount),
    currency: val(settlement?.InvoiceCurrencyCode),
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
  }))

  return {
    number: val(inv?.ID),
    issueDate: toIsoDate(inv?.IssueDate),
    dueDate: toIsoDate(inv?.DueDate),
    sellerName,
    sellerVatId: vat ?? null,
    buyerName,
    net: num(totals?.TaxExclusiveAmount),
    tax: num(first(inv?.TaxTotal)?.TaxAmount),
    gross: num(totals?.TaxInclusiveAmount) ?? num(totals?.PayableAmount),
    currency: val(inv?.DocumentCurrencyCode),
    lines,
  }
}

/** Pflichtangaben-Prüfung (EN 16931-Kern / §14 UStG, formale Ebene). */
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
  return { valid: missing.length === 0, missing }
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

export const FORMAT_LABELS: Record<DocFormat, string> = {
  ZUGFERD: 'ZUGFeRD / Factur-X',
  XRECHNUNG_CII: 'XRechnung (CII)',
  XRECHNUNG_UBL: 'XRechnung (UBL)',
  PDF: 'PDF (ohne strukturierte Daten)',
  OTHER: 'Unbekanntes Format',
}
