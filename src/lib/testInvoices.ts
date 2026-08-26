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
// (Sammel-Mail-Fall). Stefan 2026-08-25: außerdem eine Lastschrift-Demo
// (normale PDF-Rechnung mit Lastschrift-Hinweis statt Zahlungsbedingung im
// Text, testet die "wird abgebucht"-Erkennung, siehe directDebitByVendor in
// aiExtract.ts). Betreff aller Testrechnungen beginnt mit "[TEST!]",
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

// Dritte Spalte = Anschrift (Stefan 2026-08-26): fehlte bisher komplett auf
// den reinen PDF-Testrechnungen (buildPdf) — dadurch schlug die §14-UStG-
// Pflichtangaben-Prüfung bei JEDER Testrechnung mit "Anschrift fehlt" an, was
// keine echte Lücke testete, sondern nur eine Lücke im Testdaten-Generator
// war. XRechnung/ZUGFeRD hatten schon immer eine (feste, generische) Adresse
// im XML, siehe buildCiiXml/buildMixedTaxRatesXml.
const VENDORS = [
  ['Rheinwerk Bürobedarf GmbH', 'DE123456789', 'Industriestraße 14, 50823 Köln'],
  ['Nordlicht IT-Systeme GmbH', 'DE234567891', 'Hafenallee 7, 20457 Hamburg'],
  ['Baumann Elektrotechnik e.K.', 'DE345678912', 'Gewerbering 22, 70565 Stuttgart'],
  ['Vogel Logistik & Spedition GmbH', 'DE456789123', 'Speditionsweg 3, 44139 Dortmund'],
  ['Schuster Reinigungsservice GmbH', 'DE567891234', 'Reinigungsstraße 9, 04109 Leipzig'],
  ['Meyer Druck & Medien GmbH', 'DE678912345', 'Druckereiweg 5, 90411 Nürnberg'],
  ['Fischer Gartenbau GmbH', 'DE789123456', 'Gartenstraße 18, 79098 Freiburg im Breisgau'],
  ['Krüger Sicherheitstechnik GmbH', 'DE891234567', 'Sicherheitsallee 2, 45127 Essen'],
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
// Stefan 2026-08-26: VENDORS enthält u. a. "Vogel Logistik & Spedition GmbH" —
// ohne Escaping macht das rohe "&" das erzeugte XML nicht-wohlgeformt, der
// KoSIT-Validator (und jeder andere XML-Parser) lehnt es dann komplett ab.
function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

type Line = { name: string; qty: number; unit: number; discount: number; total: number }
type Invoice = {
  number: string
  issueDate: Date
  dueDate: Date
  deliveryDate: Date
  vendor: string
  vat: string
  address: string
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
  const [vendor, vat, address] = VENDORS[vendorIndex % VENDORS.length]
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
    address,
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

// Stefan 2026-08-26 ("keine Rechnung kommt durch den Validator"): die
// bisherige CII-/UBL-Erzeugung war ein bewusst vereinfachtes Mock nur für
// den EIGENEN, nachsichtigen Parser (lib/erechnung.ts) — der echte KoSIT-
// Validator erkennt sowas gar nicht erst als XRechnung (fehlender
// GuidelineSpecifiedDocumentContextParameter mit der CIUS-URN), unabhängig
// von allen anderen Pflichtangaben. Struktur jetzt an einem ECHTEN, vom
// KoSIT-Validator akzeptierten Referenzbeispiel ausgerichtet (KoSIT-
// Test-Suite, 01.01a-INVOICE_uncefact.xml) — inkl. Kontextparameter,
// TypeCode, Rechnungsempfänger-Anschrift, Zahlungsmittel (IBAN) und
// DuePayableAmount, die vorher komplett fehlten. Der Einzelpreis je Position
// wird bewusst als total/qty berechnet (nicht Bruttopreis minus separater
// Rabatt-Position) — so bleibt die Zeilensumme IMMER exakt konsistent mit
// Menge×Preis, ohne eigene BR-CO-*-Rundungsprüfungen zu riskieren; der
// Rabatt bleibt rein ein Anzeige-Detail der eigenen App (PDF/Positionszeilen).
function buildCiiXml(inv: Invoice): string {
  const lineItems = inv.lines
    .map(
      (l, i) => `    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${esc(l.name)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>${(l.total / l.qty).toFixed(2)}</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">${l.qty}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>19</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${l.total.toFixed(2)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${inv.number}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${yyyymmdd(inv.issueDate)}</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${lineItems}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>${inv.number}</ram:BuyerReference>
      <ram:SellerTradeParty>
        <ram:Name>${esc(inv.vendor)}</ram:Name>
        <ram:DefinedTradeContact>
          <ram:PersonName>${esc(inv.vendor)}</ram:PersonName>
          <ram:TelephoneUniversalCommunication><ram:CompleteNumber>+49 30 1234567</ram:CompleteNumber></ram:TelephoneUniversalCommunication>
          <ram:EmailURIUniversalCommunication><ram:URIID>rechnung@${inv.vendor.toLowerCase().replace(/\W+/g, '')}.test</ram:URIID></ram:EmailURIUniversalCommunication>
        </ram:DefinedTradeContact>
        <ram:PostalTradeAddress><ram:PostcodeCode>00000</ram:PostcodeCode><ram:LineOne>${esc(inv.address)}</ram:LineOne><ram:CityName>–</ram:CityName><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
        <ram:URIUniversalCommunication><ram:URIID schemeID="EM">rechnung@${inv.vendor.toLowerCase().replace(/\W+/g, '')}.test</ram:URIID></ram:URIUniversalCommunication>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${inv.vat}</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${BUYER}</ram:Name>
        <ram:PostalTradeAddress><ram:PostcodeCode>54321</ram:PostcodeCode><ram:LineOne>Empfängerweg 3</ram:LineOne><ram:CityName>Käuferstadt</ram:CityName><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
        <ram:URIUniversalCommunication><ram:URIID schemeID="EM">buchhaltung@demogmbh.test</ram:URIID></ram:URIUniversalCommunication>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${yyyymmdd(inv.deliveryDate)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>DE79000000001234567890</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${inv.tax.toFixed(2)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>${inv.net.toFixed(2)}</ram:BasisAmount>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>19</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradePaymentTerms>
        <ram:Description>${esc(inv.paymentTerms)}</ram:Description>
        <ram:DueDateDateTime><udt:DateTimeString format="102">${yyyymmdd(inv.dueDate)}</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${inv.net.toFixed(2)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${inv.net.toFixed(2)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${inv.tax.toFixed(2)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${inv.gross.toFixed(2)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${inv.gross.toFixed(2)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
}

function buildUblXml(inv: Invoice): string {
  const lineItems = inv.lines
    .map(
      (l, i) => `  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${l.qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">${l.total.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(l.name)}</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">${(l.total / l.qty).toFixed(2)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${inv.number}</cbc:ID>
  <cbc:IssueDate>${isoDate(inv.issueDate)}</cbc:IssueDate>
  <cbc:DueDate>${isoDate(inv.dueDate)}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${inv.number}</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="EM">rechnung@${inv.vendor.toLowerCase().replace(/\W+/g, '')}.test</cbc:EndpointID>
      <cac:PostalAddress><cbc:StreetName>${esc(inv.address)}</cbc:StreetName><cbc:CityName>–</cbc:CityName><cbc:PostalZone>00000</cbc:PostalZone><cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      <cac:PartyTaxScheme><cbc:CompanyID>${inv.vat}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(inv.vendor)}</cbc:RegistrationName></cac:PartyLegalEntity>
      <cac:Contact><cbc:Name>${esc(inv.vendor)}</cbc:Name><cbc:Telephone>+49 30 1234567</cbc:Telephone><cbc:ElectronicMail>rechnung@${inv.vendor.toLowerCase().replace(/\W+/g, '')}.test</cbc:ElectronicMail></cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:EndpointID schemeID="EM">buchhaltung@demogmbh.test</cbc:EndpointID>
      <cac:PostalAddress><cbc:StreetName>Empfängerweg 3</cbc:StreetName><cbc:CityName>Käuferstadt</cbc:CityName><cbc:PostalZone>54321</cbc:PostalZone><cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      <cac:PartyLegalEntity><cbc:RegistrationName>${BUYER}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:Delivery><cbc:ActualDeliveryDate>${isoDate(inv.deliveryDate)}</cbc:ActualDeliveryDate></cac:Delivery>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount><cbc:ID>DE79000000001234567890</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:PaymentTerms><cbc:Note>${esc(inv.paymentTerms)}</cbc:Note></cac:PaymentTerms>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${inv.tax.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${inv.net.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${inv.tax.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${inv.net.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${inv.net.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${inv.gross.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${inv.gross.toFixed(2)}</cbc:PayableAmount>
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
  // Positionstabelle braucht eine echte Monospace-Schrift (Stefan 2026-08-26):
  // mit Helvetica hat jedes Zeichen eine andere Breite, da fluchten Spalten
  // per Leerzeichen-Auffüllung NIE exakt — nur bei zufällig ähnlicher
  // Ziffernbreite sah es vorher halbwegs passend aus.
  const monoBold = await doc.embedFont(StandardFonts.CourierBold)
  const mono = await doc.embedFont(StandardFonts.Courier)
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
      page.drawText(ITEMS_HEADER, { x: 50, y, size: 9, font: monoBold, color: rgb(0.1, 0.1, 0.1) })
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
  line(inv.address)
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
  line(ITEMS_HEADER, monoBold, 9)
  inItemsSection = true
  for (const l of inv.lines) {
    // Stefan 2026-08-26: die Rabatt-Spalte war nur im "kein Rabatt"-Zweig auf
    // feste Breite gepolstert ('—'.padStart(6)) — im "hat Rabatt"-Zweig
    // (`-${l.discount.toFixed(2)}`) fehlte das padStart() komplett, dadurch
    // verschob sich die nachfolgende Betrag-Spalte je nach Ziffernzahl des
    // Rabatts zeilenweise unterschiedlich weit nach rechts.
    const discountText = (l.discount > 0 ? `-${l.discount.toFixed(2)}` : '—').padStart(7)
    line(`      ${l.name.padEnd(34)} ${String(l.qty).padStart(5)}  ${discountText}  ${l.total.toFixed(2).padStart(8)} EUR`, mono, 9, 13)
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

// Drittland-Rechnung ohne MwSt. (Stefan 2026-08-25) — Ausfuhrlieferung an
// einen Nicht-EU-Lieferanten (hier: einer der FOREIGN_VENDORS, alle
// außerhalb der EU-Umsatzsteuerzone), Steuersatz 0 % MIT dem dafür
// zwingenden Befreiungshinweis (§14 Abs. 4 Nr. 8 UStG) — testet sowohl die
// taxRates[].exemptionReason-Erkennung als auch USt-IdNr./Steuernummer
// getrennt (siehe lib/erechnung.ts ciiTaxIds).
type ThirdCountryInvoice = { number: string; vendor: string; country: string; currency: string; from: string; net: number }

function buildThirdCountryInvoice(i: number): ThirdCountryInvoice {
  const v = FOREIGN_VENDORS[i % FOREIGN_VENDORS.length]
  const stamp = Date.now().toString().slice(-6)
  return {
    number: `INV-DL-${stamp}-${pad(i + 1, 3)}`,
    vendor: v.name,
    country: v.country,
    currency: v.currency,
    from: v.from,
    net: Math.round((400 + (i % 5) * 137.5) * 100) / 100,
  }
}

function buildThirdCountryNoVatXml(inv: ThirdCountryInvoice): string {
  const today = new Date()
  const due = new Date(today)
  due.setDate(due.getDate() + 30)
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${inv.number}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${yyyymmdd(today)}</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>1</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>Export-Lieferung (Drittland)</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>${inv.net.toFixed(2)}</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">1</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>G</ram:CategoryCode><ram:RateApplicablePercent>0</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${inv.net.toFixed(2)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>${inv.number}</ram:BuyerReference>
      <ram:SellerTradeParty>
        <ram:Name>${inv.vendor}</ram:Name>
        <ram:DefinedTradeContact>
          <ram:PersonName>${inv.vendor}</ram:PersonName>
          <ram:TelephoneUniversalCommunication><ram:CompleteNumber>+1 555 0100</ram:CompleteNumber></ram:TelephoneUniversalCommunication>
          <ram:EmailURIUniversalCommunication><ram:URIID>billing@${inv.vendor.toLowerCase().replace(/\W+/g, '')}.test</ram:URIID></ram:EmailURIUniversalCommunication>
        </ram:DefinedTradeContact>
        <ram:PostalTradeAddress><ram:PostcodeCode>00000</ram:PostcodeCode><ram:LineOne>Export Avenue 1</ram:LineOne><ram:CityName>Overseas City</ram:CityName><ram:CountryID>${inv.country === 'United States' ? 'US' : inv.country === 'United Kingdom' ? 'GB' : inv.country === 'Norway' ? 'NO' : 'CH'}</ram:CountryID></ram:PostalTradeAddress>
        <ram:URIUniversalCommunication><ram:URIID schemeID="EM">billing@${inv.vendor.toLowerCase().replace(/\W+/g, '')}.test</ram:URIID></ram:URIUniversalCommunication>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${inv.vendor.replace(/\W+/g, '').slice(0, 12).toUpperCase()}-TAX</ram:ID></ram:SpecifiedTaxRegistration>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${inv.vendor.replace(/\W+/g, '').slice(0, 10).toUpperCase()}-VAT</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${BUYER}</ram:Name>
        <ram:PostalTradeAddress><ram:PostcodeCode>54321</ram:PostcodeCode><ram:LineOne>Empfängerweg 3</ram:LineOne><ram:CityName>Käuferstadt</ram:CityName><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
        <ram:URIUniversalCommunication><ram:URIID schemeID="EM">buchhaltung@demogmbh.test</ram:URIID></ram:URIUniversalCommunication>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${yyyymmdd(today)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${inv.currency}</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>DE79000000001234567890</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>0.00</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:ExemptionReason>Steuerfreie Ausfuhrlieferung in ein Drittland (§ 4 Nr. 1a i. V. m. § 6 UStG)</ram:ExemptionReason>
        <ram:BasisAmount>${inv.net.toFixed(2)}</ram:BasisAmount>
        <ram:CategoryCode>G</ram:CategoryCode>
        <ram:RateApplicablePercent>0</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradePaymentTerms>
        <ram:Description>Zahlbar innerhalb 30 Tagen</ram:Description>
        <ram:DueDateDateTime><udt:DateTimeString format="102">${yyyymmdd(due)}</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${inv.net.toFixed(2)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${inv.net.toFixed(2)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${inv.currency}">0.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${inv.net.toFixed(2)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${inv.net.toFixed(2)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
}

// Gemischte Steuersätze (Stefan 2026-08-25) — EINE Rechnung mit ZWEI
// unterschiedlichen Umsatzsteuersätzen (19 % + 7 %), z. B. Warenlieferung
// (19 %) zusammen mit Druckerzeugnissen/Büchern (7 %) — testet, dass
// taxRates[] wirklich als Array mit mehreren Einträgen behandelt wird statt
// nur den ersten/letzten Treffer zu übernehmen.
function buildMixedTaxRatesXml(i: number): { number: string; xml: string; vendor: string; gross: number } {
  const [vendor, vat] = VENDORS[i % VENDORS.length]
  const stamp = Date.now().toString().slice(-6)
  const number = `RE-MIX-${stamp}-${pad(i + 1, 3)}`
  const today = new Date()
  const due = new Date(today)
  due.setDate(due.getDate() + 14)
  const net19 = 250
  const net7 = 120
  const tax19 = Math.round(net19 * 0.19 * 100) / 100
  const tax7 = Math.round(net7 * 0.07 * 100) / 100
  const net = net19 + net7
  const tax = Math.round((tax19 + tax7) * 100) / 100
  const gross = Math.round((net + tax) * 100) / 100
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${number}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${yyyymmdd(today)}</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>1</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>Warenlieferung (19 % USt.)</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${net19.toFixed(2)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">1</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>19</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${net19.toFixed(2)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>2</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>Drucksachen/Fachliteratur (7 % USt.)</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${net7.toFixed(2)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">1</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>7</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${net7.toFixed(2)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>${number}</ram:BuyerReference>
      <ram:SellerTradeParty>
        <ram:Name>${esc(vendor)}</ram:Name>
        <ram:DefinedTradeContact>
          <ram:PersonName>${esc(vendor)}</ram:PersonName>
          <ram:TelephoneUniversalCommunication><ram:CompleteNumber>+49 30 1234567</ram:CompleteNumber></ram:TelephoneUniversalCommunication>
          <ram:EmailURIUniversalCommunication><ram:URIID>rechnung@${vendor.toLowerCase().replace(/\W+/g, '')}.test</ram:URIID></ram:EmailURIUniversalCommunication>
        </ram:DefinedTradeContact>
        <ram:PostalTradeAddress><ram:PostcodeCode>12345</ram:PostcodeCode><ram:LineOne>Musterstraße 12</ram:LineOne><ram:CityName>Musterstadt</ram:CityName><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
        <ram:URIUniversalCommunication><ram:URIID schemeID="EM">rechnung@${vendor.toLowerCase().replace(/\W+/g, '')}.test</ram:URIID></ram:URIUniversalCommunication>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${vat}</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${BUYER}</ram:Name>
        <ram:PostalTradeAddress><ram:PostcodeCode>54321</ram:PostcodeCode><ram:LineOne>Empfängerweg 3</ram:LineOne><ram:CityName>Käuferstadt</ram:CityName><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
        <ram:URIUniversalCommunication><ram:URIID schemeID="EM">buchhaltung@demogmbh.test</ram:URIID></ram:URIUniversalCommunication>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${yyyymmdd(today)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>DE79000000001234567890</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${tax19.toFixed(2)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>${net19.toFixed(2)}</ram:BasisAmount>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>19</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${tax7.toFixed(2)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>${net7.toFixed(2)}</ram:BasisAmount>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>7</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradePaymentTerms>
        <ram:Description>Zahlbar innerhalb 14 Tagen</ram:Description>
        <ram:DueDateDateTime><udt:DateTimeString format="102">${yyyymmdd(due)}</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${net.toFixed(2)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${net.toFixed(2)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${tax.toFixed(2)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${gross.toFixed(2)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${gross.toFixed(2)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
  return { number, xml, vendor, gross }
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
    | 'Drittland ohne MwSt.' | 'Gemischte Steuersätze' | 'Lastschrift (Demo)'
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
    // 5=Fehlgeleitet-Demo, 6=PDF viele Positionen, 7=PDF 2 Seiten, 8=Mehrfach-Demo,
    // 9=Drittland ohne MwSt., 10=Gemischte Steuersätze, 11=Lastschrift-Demo
    const group = i % 12

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

    if (group === 9) {
      const tc = buildThirdCountryInvoice(i)
      const xml = buildThirdCountryNoVatXml(tc)
      files.push({
        filename: `${tc.number}.xml`,
        content: Buffer.from(xml, 'utf8'),
        contentType: 'application/xml',
        htmlBody: null,
        groupLabel: 'Drittland ohne MwSt.',
        subject: `[TEST!] Invoice ${tc.number} from ${tc.vendor} (${tc.country}, 0% VAT)`,
        text: `Anbei Rechnung ${tc.number} über ${tc.net.toFixed(2)} ${tc.currency} von ${tc.vendor} (${tc.country}) — steuerfreie Ausfuhrlieferung, 0% USt.`,
        vendor: tc.vendor,
        from: tc.from,
      })
      continue
    }

    if (group === 10) {
      const mix = buildMixedTaxRatesXml(i)
      files.push({
        filename: `${mix.number}.xml`,
        content: Buffer.from(mix.xml, 'utf8'),
        contentType: 'application/xml',
        htmlBody: null,
        groupLabel: 'Gemischte Steuersätze',
        subject: `[TEST!] Rechnung ${mix.number} von ${mix.vendor} (19% + 7% USt.)`,
        text: `Anbei Rechnung ${mix.number} über ${mix.gross.toFixed(2)} EUR von ${mix.vendor} — Positionen mit unterschiedlichen Steuersätzen (19% und 7%).`,
        vendor: mix.vendor,
        from: null,
      })
      continue
    }

    if (group === 11) {
      // Lastschrift-Demo (Stefan 2026-08-25): normale PDF-Rechnung, aber mit
      // Lastschrift-Hinweis statt der üblichen Zahlungsbedingung im Text —
      // buildPdf rendert paymentTerms als Text auf die Seite, die KI liest
      // ihn beim Auslesen mit (siehe aiExtract.ts directDebitByVendor:
      // "NUR wenn im Text klar steht ... Lastschrift/SEPA-Lastschrift/
      // Einzugsermächtigung/Bankeinzug"). Demonstriert, dass "Fälligkeit"
      // dafür korrekt durch "wird abgebucht" ersetzt wird (siehe ERechnungView.tsx).
      const base = buildInvoiceWithLines(i, i, ITEM_SETS[i % ITEM_SETS.length])
      const inv: Invoice = {
        ...base,
        paymentTerms: 'Der Rechnungsbetrag wird von uns automatisch per SEPA-Lastschrift von Ihrem Konto abgebucht — keine Überweisung nötig.',
      }
      files.push({
        filename: `${inv.number}.pdf`,
        content: Buffer.from(await buildPdf(inv)),
        contentType: 'application/pdf',
        htmlBody: null,
        groupLabel: 'Lastschrift (Demo)',
        subject: `[TEST!] Rechnung ${inv.number} von ${inv.vendor} (Lastschrift)`,
        text: `Anbei Rechnung ${inv.number} über ${inv.gross.toFixed(2)} EUR von ${inv.vendor} — wird per Lastschrift abgebucht.`,
        vendor: inv.vendor,
        from: null,
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
