// Test-Rechnungen erzeugen und per Mail verschicken (Entwicklung/Demo):
// Mischung aus reinem PDF, reiner XRechnung (UBL/CII abwechselnd, mit
// Positionen/Rabatt/Lieferdatum/Zahlungsbedingung), ZUGFeRD (PDF mit
// eingebettetem XML), einer englischsprachigen HTML-Auslandsrechnung OHNE
// Anhang (Stefan 2026-08-25, Demo für den HTML-Fallback in
// lib/mailin.ts/lib/htmlToPdf.ts), zwei Demo-Fällen für die Spam-/Nicht-
// Rechnung-Klassifikation (eine eindeutige Werbe-Mail, landet im
// Spam-Verdacht-Korb, und eine versehentlich an den Rechnungseingang
// gesendete Info zu einer BEREITS bestehenden Rechnung) SOWIE — Stefan
// 2026-08-25, "zuwenige Rechnungen mit mehreren Positionszeilen/2 Seiten/
// mehreren Rechnungen pro Mail" — drei weiteren Gruppen für mehr
// Praxis-Varianz: eine PDF-Rechnung mit vielen (12) Positionszeilen, eine
// mit so vielen (55) Positionen, dass sie garantiert auf eine zweite Seite
// überläuft (buildPdf paginiert automatisch), und eine Mail mit ZWEI
// eigenständigen Rechnungen desselben Lieferanten als separate Anhänge
// (Sammel-Mail-Fall). Betreff aller Testrechnungen beginnt mit "[TEST!]",
// damit sie in einem echten Postfach klar erkennbar bleiben.
// Landen als echte E-Mail im Ziel-Postfach, zum Testen von Mail-Eingang +
// KI-Erkennung + der E-Rechnungs-Visualisierung. Genutzt von
// scripts/send-test-invoices.ts (Kommandozeile) UND vom "Testrechnungen
// senden"-Knopf im Betreiber-Cockpit (api/platform/tenants/[id]/test-invoices).
import { type Tenant } from '@prisma/client'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createGraphTestMessage } from '@/lib/graphMailin'
import { sendSystemMail } from '@/lib/mail'

const BUYER = 'Demo GmbH'

const VENDORS = [
  ['Rheinwerk Bürobedarf GmbH', 'DE123456789'],
  ['Nordlicht IT-Systeme GmbH', 'DE234567891'],
  ['Baumann Elektrotechnik e.K.', 'DE345678912'],
  ['Vogel Logistik & Spedition GmbH', 'DE456789123'],
  ['Schuster Reinigungsservice GmbH', 'DE567891234'],
  ['Meyer Druck & Medien GmbH', 'DE678912345'],
  ['Fischer Gartenbau GmbH', 'DE789123456'],
  ['Krüger Sicherheitstechnik GmbH', 'DE891234567'],
] as const

const ITEM_SETS: { name: string; qty: number; unit: number; discount?: number }[][] = [
  [{ name: 'Bürobedarf Sammelposten', qty: 1, unit: 145.5 }, { name: 'Aktenordner A4, 10er-Pack', qty: 3, unit: 18.9, discount: 8.5 }],
  [{ name: 'IT-Dienstleistung Wartung', qty: 4, unit: 95 }, { name: 'Remote-Support-Pauschale', qty: 1, unit: 60 }],
  [{ name: 'Elektroinstallation Wartungsvertrag', qty: 1, unit: 380, discount: 20 }],
  [{ name: 'Transportleistung Region West', qty: 3, unit: 90 }, { name: 'Express-Zuschlag', qty: 1, unit: 148 }],
  [{ name: 'Reinigungsleistung monatlich', qty: 1, unit: 420 }],
  [{ name: 'Druckerzeugnisse Flyer A5', qty: 500, unit: 0.42 }, { name: 'Layout-Erstellung', qty: 1, unit: 150, discount: 15 }],
  [{ name: 'Gartenpflege Quartalsvertrag', qty: 1, unit: 260 }],
  [{ name: 'Sicherheitstechnik Wartung', qty: 2, unit: 175, discount: 25 }],
]

// Auslandsrechnungen als reiner HTML-Mailtext OHNE Anhang (Stefan 2026-08-25):
// simuliert Drittland-/Auslandslieferanten, die ihre Rechnung direkt im
// Mailtext statt als PDF/XML-Anhang verschicken — Demo für den HTML-Fallback
// (lib/htmlToPdf.ts). Bewusst eigene, englischsprachige Datenbasis statt der
// deutschen VENDORS/ITEM_SETS oben.
const FOREIGN_VENDORS: { name: string; country: string; currency: string; vat: string; from: string }[] = [
  { name: 'Global Supplies Ltd.', country: 'United Kingdom', currency: 'GBP', vat: 'GB123456789', from: 'billing@global-supplies-example.co.uk' },
  { name: 'Pacific Trading Co.', country: 'United States', currency: 'USD', vat: 'EIN 12-3456789', from: 'accounts@pacific-trading-example.com' },
  { name: 'Nordic Freight AS', country: 'Norway', currency: 'NOK', vat: 'NO123456789MVA', from: 'invoices@nordic-freight-example.no' },
  { name: 'Alpine Precision SA', country: 'Switzerland', currency: 'CHF', vat: 'CHE-123.456.789', from: 'billing@alpine-precision-example.ch' },
]

const FOREIGN_ITEM_SETS: { name: string; qty: number; unit: number }[][] = [
  [{ name: 'Consulting services', qty: 8, unit: 145 }, { name: 'Travel expenses', qty: 1, unit: 220 }],
  [{ name: 'Freight & logistics handling', qty: 1, unit: 890 }],
  [{ name: 'Precision components, batch', qty: 50, unit: 24.5 }],
  [{ name: 'Software license (annual)', qty: 1, unit: 1200 }],
]

type ForeignLine = { name: string; qty: number; unit: number; total: number }
type ForeignInvoice = {
  number: string
  issueDate: Date
  dueDate: Date
  vendor: string
  country: string
  currency: string
  vat: string
  from: string
  lines: ForeignLine[]
  net: number
  tax: number
  gross: number
}

function buildForeignInvoices(count: number): ForeignInvoice[] {
  const out: ForeignInvoice[] = []
  const today = new Date()
  const stamp = Date.now().toString().slice(-6)
  for (let i = 0; i < count; i++) {
    const v = FOREIGN_VENDORS[i % FOREIGN_VENDORS.length]
    const items = FOREIGN_ITEM_SETS[i % FOREIGN_ITEM_SETS.length]
    const issue = new Date(today)
    issue.setDate(issue.getDate() - (i % 5))
    const due = new Date(issue)
    due.setDate(due.getDate() + 30)
    const lines = items.map((it) => ({ ...it, total: Math.round(it.qty * it.unit * 100) / 100 }))
    const net = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100
    const tax = Math.round(net * 0.2 * 100) / 100
    const gross = Math.round((net + tax) * 100) / 100
    out.push({
      number: `INV-${stamp}-${pad(i + 1, 3)}`,
      issueDate: issue,
      dueDate: due,
      vendor: v.name,
      country: v.country,
      currency: v.currency,
      vat: v.vat,
      from: v.from,
      lines,
      net,
      tax,
      gross,
    })
  }
  return out
}

function buildForeignInvoiceHtml(inv: ForeignInvoice): string {
  const rows = inv.lines
    .map(
      (l) => `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd;">${l.name}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;">${l.qty}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;">${l.unit.toFixed(2)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right;">${l.total.toFixed(2)}</td>
    </tr>`,
    )
    .join('')
  return `<html><body style="font-family:Arial,sans-serif;color:#222;max-width:640px;">
    <h2 style="margin-bottom:0;">${inv.vendor}</h2>
    <p style="margin-top:2px;color:#666;">${inv.country} · VAT/Tax ID: ${inv.vat}</p>
    <h3>INVOICE ${inv.number}</h3>
    <p>Issue date: ${isoDate(inv.issueDate)}<br/>Due date: ${isoDate(inv.dueDate)}<br/>Bill to: ${BUYER}</p>
    <table style="border-collapse:collapse;width:100%;margin-top:12px;">
      <thead><tr>
        <th style="text-align:left;padding:4px 8px;border-bottom:2px solid #333;">Description</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:2px solid #333;">Qty</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:2px solid #333;">Unit price</th>
        <th style="text-align:right;padding:4px 8px;border-bottom:2px solid #333;">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="text-align:right;margin-top:8px;">
      Subtotal: ${inv.net.toFixed(2)} ${inv.currency}<br/>
      VAT/Tax: ${inv.tax.toFixed(2)} ${inv.currency}<br/>
      <strong>Total due: ${inv.gross.toFixed(2)} ${inv.currency}</strong>
    </p>
    <p style="margin-top:20px;color:#666;font-size:12px;">Payment due within 30 days. No attachment — invoice sent as plain email text (common for overseas vendors). Thank you for your business.</p>
  </body></html>`
}

// Spam-Demo (Stefan 2026-08-25): eindeutige Werbe-Mail mit PDF-Anhang, KEIN
// Rechnungsbezug — Demonstration des Spam-Verdacht-Korbs (lib/mailin.ts
// classifyByKeywords, wenn kein KI-Anbieter konfiguriert ist).
async function buildSpamPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([420, 300])
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const normal = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('SONDERANGEBOT!', { x: 40, y: 250, size: 22, font: bold, color: rgb(0.8, 0, 0) })
  page.drawText('70% Rabatt auf unser gesamtes Sortiment — nur heute!', { x: 40, y: 210, size: 11, font: normal })
  page.drawText('Jetzt klicken und sparen: www.beispiel-shop.test/angebot', { x: 40, y: 190, size: 11, font: normal })
  page.drawText('Diese E-Mail ist eine Werbe-Nachricht.', { x: 40, y: 90, size: 9, font: normal })
  page.drawText('Newsletter abbestellen: unsubscribe@beispiel-shop.test', { x: 40, y: 70, size: 9, font: normal })
  return Buffer.from(await doc.save())
}

// Fehlgeleitet-Demo (Stefan 2026-08-25): Info zu einer BEREITS bestehenden,
// beglichenen Rechnung, versehentlich an den Rechnungseingang statt an die
// Buchhaltung gesendet — kein neuer Beleg, sollte nicht unkritisch
// übernommen werden (siehe ALREADY_SETTLED_PATTERN in lib/mailin.ts).
function buildMisdirectedHtml(): string {
  return `<html><body style="font-family:Arial,sans-serif;color:#222;">
    <p>Sehr geehrte Damen und Herren,</p>
    <p>hiermit bestätigen wir den Zahlungseingang zu Ihrer Rechnung <strong>RE-2025-1234</strong>
    über <strong>542,00 EUR</strong>.</p>
    <p>Die Rechnung wurde bereits beglichen — es ist keine weitere Aktion Ihrerseits erforderlich.
    Diese Nachricht dient lediglich Ihren Unterlagen.</p>
    <p>Mit freundlichen Grüßen<br/>Ihre Buchhaltung</p>
  </body></html>`
}

function pad(n: number, len = 2) {
  return String(n).padStart(len, '0')
}
function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function yyyymmdd(d: Date) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

type Line = { name: string; qty: number; unit: number; discount: number; total: number }
type Invoice = {
  number: string
  issueDate: Date
  dueDate: Date
  deliveryDate: Date
  vendor: string
  vat: string
  lines: Line[]
  net: number
  tax: number
  gross: number
  paymentTerms: string
}

// Pool für generierte Positionszeilen (Stefan 2026-08-25) — für die
// "viele Positionen"/"2 Seiten"-Demogruppen unten, wo ITEM_SETS' 1-2
// Positionen pro Rechnung zu wenig Realismus für die Vorschau/KI-Erkennung
// abbilden (echte Rechnungen haben oft 10-50+ Zeilen).
const POSITION_POOL = [
  'Bürobedarf Sammelposten', 'Kopierpapier A4 80g', 'Tonerkartusche Schwarz', 'Tonerkartusche Farbe',
  'USB-Stick 32GB', 'Netzwerkkabel Cat6', 'Wartungspauschale', 'Ersatzteil-Set', 'Montagearbeit (Std.)',
  'Anfahrtspauschale', 'Verbrauchsmaterial', 'Software-Lizenz (Jahr)', 'Schulung (Tag)',
  'Reinigungsmittel', 'Handwerkerleistung (Std.)', 'Frachtkosten', 'Verpackungsmaterial',
  'Ersatzakku', 'Kabelbinder-Set', 'Klimaanlagenfilter',
]
function buildManyLines(count: number): { name: string; qty: number; unit: number; discount?: number }[] {
  const lines = []
  for (let i = 0; i < count; i++) {
    const base = POSITION_POOL[i % POSITION_POOL.length]
    const qty = 1 + (i % 5)
    const unit = Math.round((4.5 + ((i * 7) % 50)) * 100) / 100
    lines.push({
      name: `${base} #${i + 1}`,
      qty,
      unit,
      discount: i % 6 === 0 ? Math.round(unit * qty * 0.05 * 100) / 100 : undefined,
    })
  }
  return lines
}

/** Baut eine einzelne Rechnung — `numberIndex` bestimmt die Rechnungsnummer, `vendorIndex` den Lieferanten (getrennt, damit derselbe Lieferant mehrere, unterschiedlich nummerierte Rechnungen bekommen kann — siehe Gruppe "Mehrfach"). */
function buildInvoiceWithLines(
  numberIndex: number,
  vendorIndex: number,
  items: { name: string; qty: number; unit: number; discount?: number }[],
): Invoice {
  const [vendor, vat] = VENDORS[vendorIndex % VENDORS.length]
  const today = new Date()
  const stamp = Date.now().toString().slice(-6)
  const issue = new Date(today)
  issue.setDate(issue.getDate() - (numberIndex % 5))
  const delivery = new Date(issue)
  delivery.setDate(delivery.getDate() - 2)
  const due = new Date(issue)
  due.setDate(due.getDate() + 14)

  const lines: Line[] = items.map((it) => {
    const gross = it.qty * it.unit
    const discount = it.discount ?? 0
    return { name: it.name, qty: it.qty, unit: it.unit, discount, total: Math.round((gross - discount) * 100) / 100 }
  })
  const net = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100
  const tax = Math.round(net * 0.19 * 100) / 100
  const gross = Math.round((net + tax) * 100) / 100

  return {
    number: `RE-TEST-${stamp}-${pad(numberIndex + 1, 3)}`,
    issueDate: issue,
    dueDate: due,
    deliveryDate: delivery,
    vendor,
    vat,
    lines,
    net,
    tax,
    gross,
    paymentTerms: 'Zahlbar innerhalb 14 Tagen ohne Abzug, 2% Skonto bei Zahlung innerhalb 7 Tagen.',
  }
}

function buildInvoices(count: number): Invoice[] {
  const out: Invoice[] = []
  for (let i = 0; i < count; i++) {
    out.push(buildInvoiceWithLines(i, i, ITEM_SETS[i % ITEM_SETS.length]))
  }
  return out
}

function buildCiiXml(inv: Invoice): string {
  const lineItems = inv.lines
    .map(
      (l) => `    <ram:IncludedSupplyChainTradeLineItem>
      <ram:SpecifiedTradeProduct><ram:Name>${l.name}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity>${l.qty}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        ${l.discount > 0 ? `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator><ram:ActualAmount>${l.discount.toFixed(2)}</ram:ActualAmount></ram:SpecifiedTradeAllowanceCharge>` : ''}
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${l.total.toFixed(2)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument>
    <ram:ID>${inv.number}</ram:ID>
    <ram:IssueDateTime><udt:DateTimeString format="102">${yyyymmdd(inv.issueDate)}</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${inv.vendor}</ram:Name>
        <ram:SpecifiedTaxRegistration><ram:ID>${inv.vat}</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>${BUYER}</ram:Name></ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${yyyymmdd(inv.deliveryDate)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradePaymentTerms>
        <ram:Description>${inv.paymentTerms}</ram:Description>
        <ram:DueDateDateTime><udt:DateTimeString format="102">${yyyymmdd(inv.dueDate)}</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>${inv.net.toFixed(2)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount>${inv.tax.toFixed(2)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${inv.gross.toFixed(2)}</ram:GrandTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
${lineItems}
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
}

function buildUblXml(inv: Invoice): string {
  const lineItems = inv.lines
    .map(
      (l) => `  <cac:InvoiceLine>
    <cbc:InvoicedQuantity>${l.qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount>${l.total.toFixed(2)}</cbc:LineExtensionAmount>
    ${l.discount > 0 ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount>${l.discount.toFixed(2)}</cbc:Amount></cac:AllowanceCharge>` : ''}
    <cac:Item><cbc:Name>${l.name}</cbc:Name></cac:Item>
  </cac:InvoiceLine>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${inv.number}</cbc:ID>
  <cbc:IssueDate>${isoDate(inv.issueDate)}</cbc:IssueDate>
  <cbc:DueDate>${isoDate(inv.dueDate)}</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:Delivery><cbc:ActualDeliveryDate>${isoDate(inv.deliveryDate)}</cbc:ActualDeliveryDate></cac:Delivery>
  <cac:PaymentTerms><cbc:Note>${inv.paymentTerms}</cbc:Note></cac:PaymentTerms>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyLegalEntity><cbc:RegistrationName>${inv.vendor}</cbc:RegistrationName></cac:PartyLegalEntity>
      <cac:PartyTaxScheme><cbc:CompanyID>${inv.vat}</cbc:CompanyID></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>${BUYER}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount>${inv.tax.toFixed(2)}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount>${inv.net.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount>${inv.gross.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount>${inv.gross.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lineItems}
</Invoice>`
}

const PDF_PAGE_HEIGHT = 842
const PDF_START_Y = 790
const PDF_MARGIN_BOTTOM = 60
const ITEMS_HEADER = 'Pos.  Bezeichnung                          Menge   Rabatt   Betrag'

// Paginiert automatisch (Stefan 2026-08-25): bei vielen Positionszeilen soll
// eine Rechnung wie im echten Leben auf eine zweite/weitere Seite überlaufen,
// statt Text unten aus der Seite laufen zu lassen — vorher fest eine einzige
// Seite ([595, 842]), egal wie viele Zeilen.
async function buildPdf(inv: Invoice): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let page = doc.addPage([595, PDF_PAGE_HEIGHT])
  let y = PDF_START_Y
  let pageNum = 1
  let inItemsSection = false

  const drawPageNumber = () => {
    page.drawText(`Seite ${pageNum}`, { x: 520, y: PDF_START_Y, size: 8, font, color: rgb(0.5, 0.5, 0.5) })
  }
  const newPage = () => {
    page = doc.addPage([595, PDF_PAGE_HEIGHT])
    y = PDF_START_Y
    pageNum++
    drawPageNumber()
    page.drawText(`${inv.vendor} — Rechnung ${inv.number} (Fortsetzung)`, { x: 50, y, size: 10, font: bold, color: rgb(0.3, 0.3, 0.3) })
    y -= 20
    if (inItemsSection) {
      page.drawText(ITEMS_HEADER, { x: 50, y, size: 9, font: bold, color: rgb(0.1, 0.1, 0.1) })
      y -= 13
    }
  }
  const ensureSpace = (gap: number) => {
    if (y - gap < PDF_MARGIN_BOTTOM) newPage()
  }
  const line = (text: string, f = font, size = 10, gap = 15) => {
    ensureSpace(gap)
    page.drawText(text, { x: 50, y, size, font: f, color: rgb(0.1, 0.1, 0.1) })
    y -= gap
  }

  drawPageNumber()
  line(inv.vendor, bold, 15, 24)
  line(`USt-ID: ${inv.vat}`)
  y -= 8
  line('RECHNUNG', bold, 13, 22)
  line(`Rechnungsnummer: ${inv.number}`)
  line(`Rechnungsdatum: ${isoDate(inv.issueDate)}`)
  line(`Lieferdatum: ${isoDate(inv.deliveryDate)}`)
  line(`Fällig am: ${isoDate(inv.dueDate)}`)
  y -= 8
  line(`Rechnungsempfänger: ${BUYER}`)
  y -= 10
  line(ITEMS_HEADER, bold, 9)
  inItemsSection = true
  for (const l of inv.lines) {
    line(`      ${l.name.padEnd(34)} ${String(l.qty).padStart(5)}  ${l.discount > 0 ? `-${l.discount.toFixed(2)}` : '—'.padStart(6)}  ${l.total.toFixed(2)} EUR`, font, 9, 13)
  }
  inItemsSection = false
  y -= 6
  ensureSpace(70)
  line(`Netto: ${inv.net.toFixed(2)} EUR`)
  line(`USt. 19%: ${inv.tax.toFixed(2)} EUR`)
  line(`Gesamt: ${inv.gross.toFixed(2)} EUR`, bold, 11)
  y -= 6
  line(inv.paymentTerms, font, 8)
  return doc.save()
}

async function buildZugferdPdf(inv: Invoice): Promise<Uint8Array> {
  const pdfBytes = await buildPdf(inv)
  const doc = await PDFDocument.load(pdfBytes)
  await doc.attach(Buffer.from(buildCiiXml(inv), 'utf8'), 'factur-x.xml', {
    mimeType: 'application/xml',
    description: 'ZUGFeRD/Factur-X invoice data',
  })
  return doc.save()
}

export type SendTestInvoicesResult = { sent: number; failed: number; log: string[] }

type TestInvoiceFile = {
  // Bei HTML-Auslandsrechnungen (kein Anhang) sind filename/content/contentType
  // null, dafür ist htmlBody gesetzt — siehe buildForeignInvoiceHtml oben.
  filename: string | null
  content: Buffer | null
  contentType: string | null
  htmlBody: string | null
  groupLabel:
    | 'PDF' | 'XML' | 'ZUGFeRD' | 'HTML (Ausland)' | 'SPAM (Demo)' | 'Fehlgeleitet (Demo)'
    | 'PDF (viele Positionen)' | 'PDF (2 Seiten)' | 'Mehrfach (Demo)'
  subject: string
  text: string
  vendor: string
  // Bei HTML-Auslandsrechnungen und den beiden Klassifikations-Demos gesetzt
  // — realistischere Absenderadresse als die generische
  // "rechnung@<lieferant>.test" der normalen Anhang-Gruppen.
  from: string | null
  // Sammel-Mail-Demo (Stefan 2026-08-25): weitere, EIGENSTÄNDIGE Rechnungen
  // als zusätzliche Anhänge derselben Mail — simuliert einen Lieferanten,
  // der mehrere Rechnungen in einer Sammel-Mail statt einzeln verschickt.
  extraAttachments?: { filename: string; content: Buffer; contentType: string }[]
}

/** Baut `count` Test-Belege (PDF/XRechnung/ZUGFeRD/HTML-Auslandsrechnung/Spam-Demo/Fehlgeleitet-Demo/viele-Positionen/2-Seiten/Mehrfach-Demo) — gemeinsamer Kern für beide Versandwege unten. */
async function buildTestInvoiceFiles(count: number): Promise<TestInvoiceFile[]> {
  const invoices = buildInvoices(count)
  const foreignInvoices = buildForeignInvoices(count)
  const files: TestInvoiceFile[] = []
  for (let i = 0; i < count; i++) {
    // 0=PDF, 1=XML, 2=ZUGFeRD, 3=HTML-Auslandsrechnung, 4=Spam-Demo,
    // 5=Fehlgeleitet-Demo, 6=PDF viele Positionen, 7=PDF 2 Seiten, 8=Mehrfach-Demo
    const group = i % 9

    if (group === 3) {
      const finv = foreignInvoices[i]
      files.push({
        filename: null,
        content: null,
        contentType: null,
        htmlBody: buildForeignInvoiceHtml(finv),
        groupLabel: 'HTML (Ausland)',
        subject: `[TEST!] Invoice ${finv.number} from ${finv.vendor}`,
        text: `Please find your invoice ${finv.number} (${finv.gross.toFixed(2)} ${finv.currency}) in the body of this email — no attachment.`,
        vendor: finv.vendor,
        from: finv.from,
      })
      continue
    }

    if (group === 4) {
      files.push({
        filename: 'angebot.pdf',
        content: await buildSpamPdf(),
        contentType: 'application/pdf',
        htmlBody: null,
        groupLabel: 'SPAM (Demo)',
        subject: '[TEST!] Exklusives Angebot – 70% Rabatt nur heute!',
        text: 'Nur heute: 70% Rabatt auf unser gesamtes Sortiment! Jetzt klicken und sparen.',
        vendor: 'Marketing-Absender (Demo)',
        from: 'newsletter@beispiel-shop.test',
      })
      continue
    }

    if (group === 5) {
      files.push({
        filename: null,
        content: null,
        contentType: null,
        htmlBody: buildMisdirectedHtml(),
        groupLabel: 'Fehlgeleitet (Demo)',
        subject: '[TEST!] Zahlungsbestätigung zu Rechnung RE-2025-1234',
        text: 'Zahlungseingang zu Rechnung RE-2025-1234 (542,00 EUR) bestätigt — bereits beglichen.',
        vendor: 'Eigene Buchhaltung (Demo)',
        from: 'buchhaltung@musterfirma-test.example',
      })
      continue
    }

    if (group === 6) {
      const inv = buildInvoiceWithLines(i, i, buildManyLines(12))
      files.push({
        filename: `${inv.number}.pdf`,
        content: Buffer.from(await buildPdf(inv)),
        contentType: 'application/pdf',
        htmlBody: null,
        groupLabel: 'PDF (viele Positionen)',
        subject: `[TEST!] Rechnung ${inv.number} von ${inv.vendor} (${inv.lines.length} Positionen)`,
        text: `Anbei Rechnung ${inv.number} über ${inv.gross.toFixed(2)} EUR von ${inv.vendor} (${inv.lines.length} Positionen).`,
        vendor: inv.vendor,
        from: null,
      })
      continue
    }

    if (group === 7) {
      const inv = buildInvoiceWithLines(i, i, buildManyLines(55))
      files.push({
        filename: `${inv.number}.pdf`,
        content: Buffer.from(await buildPdf(inv)),
        contentType: 'application/pdf',
        htmlBody: null,
        groupLabel: 'PDF (2 Seiten)',
        subject: `[TEST!] Rechnung ${inv.number} von ${inv.vendor} (${inv.lines.length} Positionen, 2 Seiten)`,
        text: `Anbei Rechnung ${inv.number} über ${inv.gross.toFixed(2)} EUR von ${inv.vendor} (${inv.lines.length} Positionen, umfasst 2 Seiten).`,
        vendor: inv.vendor,
        from: null,
      })
      continue
    }

    if (group === 8) {
      const vendorIdx = i % VENDORS.length
      const invA = buildInvoiceWithLines(i, vendorIdx, ITEM_SETS[i % ITEM_SETS.length])
      const invB = buildInvoiceWithLines(i + 500, vendorIdx, ITEM_SETS[(i + 2) % ITEM_SETS.length])
      const pdfA = Buffer.from(await buildPdf(invA))
      const pdfB = Buffer.from(await buildPdf(invB))
      files.push({
        filename: `${invA.number}.pdf`,
        content: pdfA,
        contentType: 'application/pdf',
        htmlBody: null,
        groupLabel: 'Mehrfach (Demo)',
        subject: `[TEST!] Sammelrechnung: ${invA.number} und ${invB.number} von ${invA.vendor}`,
        text: `Anbei zwei Rechnungen in einer Mail von ${invA.vendor}: ${invA.number} (${invA.gross.toFixed(2)} EUR) und ${invB.number} (${invB.gross.toFixed(2)} EUR).`,
        vendor: invA.vendor,
        from: null,
        extraAttachments: [{ filename: `${invB.number}.pdf`, content: pdfB, contentType: 'application/pdf' }],
      })
      continue
    }

    const inv = invoices[i]
    let filename: string
    let content: Buffer
    let contentType: string
    let groupLabel: 'PDF' | 'XML' | 'ZUGFeRD'

    if (group === 0) {
      filename = `${inv.number}.pdf`
      content = Buffer.from(await buildPdf(inv))
      contentType = 'application/pdf'
      groupLabel = 'PDF'
    } else if (group === 1) {
      filename = `${inv.number}.xml`
      content = Buffer.from(i % 2 === 0 ? buildUblXml(inv) : buildCiiXml(inv), 'utf8')
      contentType = 'application/xml'
      groupLabel = 'XML'
    } else {
      filename = `${inv.number}.pdf`
      content = Buffer.from(await buildZugferdPdf(inv))
      contentType = 'application/pdf'
      groupLabel = 'ZUGFeRD'
    }

    files.push({
      filename,
      content,
      contentType,
      htmlBody: null,
      groupLabel,
      subject: `[TEST!] Rechnung ${inv.number} von ${inv.vendor}`,
      text: `Anbei Rechnung ${inv.number} über ${inv.gross.toFixed(2)} EUR von ${inv.vendor}.`,
      vendor: inv.vendor,
      from: null,
    })
  }
  return files
}

/** Erzeugt `count` Testrechnungen (gemischt PDF/XRechnung/ZUGFeRD) und verschickt sie als echte Mail an `to`. */
export async function sendTestInvoices(to: string, count: number): Promise<SendTestInvoicesResult> {
  const files = await buildTestInvoiceFiles(count)
  let sent = 0
  let failed = 0
  const log: string[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const label = f.filename ?? `${f.groupLabel} (Mailtext)`
    try {
      const result = f.htmlBody
        ? await sendSystemMail(to, f.subject, f.text, undefined, f.htmlBody)
        : await sendSystemMail(to, f.subject, f.text, [
            { filename: f.filename!, content: f.content! },
            ...(f.extraAttachments ?? []).map((a) => ({ filename: a.filename, content: a.content })),
          ])
      if (result.sent) {
        sent++
        log.push(`[${i + 1}/${count}] ${label} gesendet (${f.groupLabel}).`)
      } else {
        failed++
        log.push(`[${i + 1}/${count}] ${label} fehlgeschlagen: ${result.reason}`)
      }
    } catch (e) {
      failed++
      log.push(`[${i + 1}/${count}] ${label} Ausnahme: ${e instanceof Error ? e.message : String(e)}`)
    }
    await new Promise((r) => setTimeout(r, 400)) // Graph-/SMTP-Rate-Limit schonen
  }
  return { sent, failed, log }
}

/**
 * Erzeugt `count` Testrechnungen und legt sie per Graph-API DIREKT im
 * konfigurierten Mail-Eingang-Ordner an (statt sie normal zu versenden) —
 * eine per sendMail verschickte Mail landet zwar im Postfach, aber eine
 * dort eingerichtete Posteingangsregel (z. B. "nach Rechnungseingang
 * verschieben") greift bei per API gesendeter Post beobachtbar oft nicht.
 * Damit umgeht "Testrechnungen senden" dieses Problem komplett, statt sich
 * auf die Regel zu verlassen.
 */
export async function sendTestInvoicesToGraphFolder(
  tenant: Pick<Tenant, 'mailInGraphTenantId' | 'mailInGraphClientId' | 'mailInGraphClientSecret'>,
  mailbox: string,
  folderPath: string | null | undefined,
  count: number,
): Promise<SendTestInvoicesResult> {
  const files = await buildTestInvoiceFiles(count)
  let sent = 0
  let failed = 0
  const log: string[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const from = f.from ?? `rechnung@${f.vendor.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}.test`
    const label = f.filename ?? `${f.groupLabel} (Mailtext)`
    try {
      if (f.htmlBody) {
        await createGraphTestMessage(tenant, mailbox, folderPath, from, f.subject, f.text, [], f.htmlBody)
      } else {
        await createGraphTestMessage(tenant, mailbox, folderPath, from, f.subject, f.text, [
          { filename: f.filename!, contentType: f.contentType!, content: f.content! },
          ...(f.extraAttachments ?? []),
        ])
      }
      sent++
      log.push(`[${i + 1}/${count}] ${label} in Ordner angelegt (${f.groupLabel}).`)
    } catch (e) {
      failed++
      log.push(`[${i + 1}/${count}] ${label} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`)
    }
    await new Promise((r) => setTimeout(r, 200)) // Graph-Rate-Limit schonen
  }
  return { sent, failed, log }
}
