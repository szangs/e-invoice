// DATEV-Export (Buchungsstapel, EXTF-Format) — Stefan 2026-07-08: erster
// Export-Weg für die Übergabe an die Finanzbuchhaltung. Bucht jede Rechnung
// mit dem Bruttobetrag auf ein Sammel-Kreditorenkonto gegen ein
// Sammel-Gegenkonto (siehe Tenant.datevKreditorenkonto/-Gegenkonto) — die
// weitere Kontierung je Lieferant bleibt bewusst Aufgabe der Fibu in DATEV
// selbst (Stefans Entscheidung: "Ein Sammelkonto für alle" statt eigener
// Lieferanten-Stammdaten mit Kontonummer je Kreditor).
//
// Stefan 2026-08-26 ("das sagt das DATEV-Prüftool"): der Nutzer hat einen
// echten Export durch das offizielle DATEV-Format-Prüfprogramm laufen lassen
// — dabei kamen mehrere echte Format-Fehler zutage, die hier behoben wurden
// (Feldliste anhand der öffentlichen DATEV-Developer-Doku und einer
// Referenzimplementierung recherchiert, siehe Commit-Historie):
//  - Feld 1 "DATEV-Format-KZ" MUSS als "EXTF" (mit Anführungszeichen)
//    geschrieben werden, nicht unquoted.
//  - Die Header-Datumsfelder WJ-Beginn/Datum-von/Datum-bis erwarten
//    JJJJMMTT (Jahr zuerst), NICHT TTMMJJJJ — das Belegdatum in den
//    Buchungssätzen bleibt bei TTMM (4-stellig, ohne Jahr), das war schon
//    richtig.
//  - Der Header braucht ALLE 31 Felder (auch wenn die hinteren nur
//    reserviert/leer sind), vorher wurden nur 22 geschrieben — DATEV lehnt
//    das als "zu wenige Felder" ab.
//  - Bestimmte Buchungssatz-Felder (Soll/Haben-Kz, WKZ Umsatz, WKZ
//    Basis-Umsatz, BU-Schlüssel, Belegfeld 1+2, Buchungstext) müssen IMMER
//    in Anführungszeichen stehen, unabhängig vom Inhalt — anders als beim
//    Header (dort nur bei Bedarf, siehe csvField).
//  - Das für Formatversion 9 deklarierte "120 Felder" pro Buchungssatz
//    verlangt DATEV auch wirklich befüllt/aufgefüllt (nicht nach der letzten
//    belegten Spalte abschneidbar, wie eine ältere Annahme hier fälschlich
//    unterstellte) — jetzt bis Spalte 120 mit Leerfeldern aufgefüllt.
//  - Kostenstelle/Kostenträger (Invoice.costCenterCode/costCarrierCode)
//    stehen laut Referenzimplementierung an Spalte 37 (KOST1) und 38 (KOST2)
//    — werden jetzt dort korrekt eingetragen (vorher komplett ausgelassen,
//    siehe alte TODO-Notiz unten).
type DatevInvoice = {
  vendor: string
  invoiceNumber: string | null
  docId: string | null
  invoiceDate: Date | null
  createdAt: Date
  amountNet: number | null
  amountTax: number | null
  amountGross: number | null
  currency: string
  costCenterCode?: string | null
  costCarrierCode?: string | null
}

export type DatevSettings = {
  datevBeraternr: string | null
  datevMandantnr: string | null
  datevSachkontenlaenge: number | null
  datevKreditorenkonto: string | null
  datevGegenkonto: string | null
  datevWjBeginn: string | null // TTMM
  datevSkr: string | null // "SKR03" | "SKR04"
}

/** Wirft, wenn eine Pflichtangabe für den DATEV-Export fehlt (Stefan
 * 2026-08-26) — lieber ein klarer Fehler beim Export als eine Datei, die
 * DATEV wegen fehlender Mussfelder ablehnt (Berater-/Mandantennummer, SKR). */
export function validateDatevSettings(settings: DatevSettings): string[] {
  const missing: string[] = []
  if (!settings.datevBeraternr) missing.push('Beraternummer')
  if (!settings.datevMandantnr) missing.push('Mandantennummer')
  if (!settings.datevSkr) missing.push('Kontenrahmen (SKR03/SKR04)')
  if (!settings.datevKreditorenkonto) missing.push('Kreditorenkonto (Sammelkonto)')
  if (!settings.datevGegenkonto) missing.push('Gegenkonto (Sammelkonto)')
  return missing
}

function csvField(v: string): string {
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** Für Buchungssatz-Felder, die laut DATEV-Format IMMER in Anführungszeichen
 * stehen müssen, unabhängig vom Inhalt (Stefan 2026-08-26) — anders als
 * csvField() oben, das nur bei Bedarf (Header-Felder) quotet. */
function datevText(v: string): string {
  return `"${v.replace(/"/g, '""')}"`
}

function ddmm(d: Date): string {
  return String(d.getUTCDate()).padStart(2, '0') + String(d.getUTCMonth() + 1).padStart(2, '0')
}

/** Header-Datumsfelder (WJ-Beginn, Datum von, Datum bis) — JJJJMMTT, Jahr
 * zuerst (Stefan 2026-08-26, per DATEV-Prüftool als "unzulässig" zurück-
 * gewiesen — vorher fälschlich TTMMJJJJ wie beim Belegdatum in Buchungssätzen). */
function yyyymmdd(d: Date): string {
  return (
    String(d.getUTCFullYear()) +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0')
  )
}

function amount(n: number): string {
  return Math.abs(n).toFixed(2).replace('.', ',')
}

/** BU-Schlüssel für die Standard-Vorsteuerautomatik (SKR03/SKR04 identisch
 * belegt: 9 = 19 %, 8 = 7 %) — grob aus dem Verhältnis Steuer/Netto
 * abgeleitet, da wir keinen expliziten Steuersatz je Position speichern.
 * Bei Unsicherheit bleibt das Feld leer (Fibu ergänzt manuell in DATEV). */
function guessBuKey(net: number | null, tax: number | null): string {
  if (!net || tax === null || tax === undefined) return ''
  const rate = tax / net
  if (rate > 0.17 && rate < 0.21) return '9'
  if (rate > 0.05 && rate < 0.09) return '8'
  return ''
}

export function buildDatevExport(
  invoices: DatevInvoice[],
  settings: DatevSettings,
  meta: { exportedBy: string },
  // Optionale Lieferanten→Konto-Zuordnung (Stefan 2026-07-08, per CSV-Import
  // befüllbar, siehe VendorAccount) — Schlüssel = Lieferantenname in
  // Kleinbuchstaben/getrimmt. Ohne Treffer gilt weiterhin das Sammelkonto.
  vendorAccounts: Record<string, string> = {},
): string {
  const now = new Date()
  const belegDates = invoices.map((i) => i.invoiceDate ?? i.createdAt)
  const minDate = new Date(Math.min(...belegDates.map((d) => d.getTime())))
  const maxDate = new Date(Math.max(...belegDates.map((d) => d.getTime())))
  // WJ-Beginn wird als TTMM hinterlegt (Tenant.datevWjBeginn, z. B. "0101"),
  // das Header-Feld selbst braucht aber JJJJMMTT — Tag/Monat aus der
  // Einstellung, Jahr aus dem frühesten Beleg im Stapel.
  const wjTag = settings.datevWjBeginn && /^\d{4}$/.test(settings.datevWjBeginn) ? settings.datevWjBeginn : '0101'
  const wjBeginn = `${minDate.getUTCFullYear()}${wjTag.slice(2, 4)}${wjTag.slice(0, 2)}`
  const sachkontenlaenge = settings.datevSachkontenlaenge ?? 4
  // Stefan 2026-08-26 (Review-Fund): nutzt jetzt denselben yyyymmdd()-Helfer
  // wie die anderen Header-Datumsfelder statt das Datum ein zweites Mal von
  // Hand zu bauen — vorher zusätzlich inkonsistent in LOKALER statt UTC-Zeit,
  // während der Rest der Datei durchgehend UTC verwendet.
  const erzeugtAm =
    yyyymmdd(now) +
    `${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}000`
  // "SKR03"/"SKR04" (Tenant.datevSkr) → das Header-Feld will nur die
  // zweistellige Kontenrahmen-Nummer ("03"/"04").
  const skr = (settings.datevSkr ?? '').replace(/\D/g, '').padStart(2, '0').slice(-2)

  const headerRow = [
    '"EXTF"', '700', '21', 'Buchungsstapel', '9',
    erzeugtAm, '', 'EI', csvField(meta.exportedBy.slice(0, 25)), '',
    settings.datevBeraternr ?? '', settings.datevMandantnr ?? '',
    wjBeginn, String(sachkontenlaenge),
    yyyymmdd(minDate), yyyymmdd(maxDate),
    csvField('E-Invoice Uebergabekorb'), '', '1', '', '0', 'EUR',
    '', '', '', '', // 23 reserviert, 24 Derivatskennzeichen, 25/26 reserviert
    skr, '', '', '', '', // 27 SKR, 28 Branchenlösung-Id, 29/30 reserviert, 31 Anwendungsinformation
  ].join(';')

  const columnHeaderRow = [
    'Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs',
    'Basis-Umsatz', 'WKZ Basis-Umsatz', 'Konto', 'Gegenkonto (ohne BU-Schlüssel)',
    'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext',
  ].join(';')

  // Für Formatversion 9 verlangt DATEV 120 Felder je Buchungssatz, auch wenn
  // die meisten davon reserviert/leer bleiben (Stefan 2026-08-26, siehe
  // Kommentar oben) — als 120er-Array aufgebaut statt Zeile für Zeile
  // aufzuzählen, damit die Spaltenposition unzweifelhaft stimmt.
  const DATA_ROW_FIELD_COUNT = 120
  const KOST1_INDEX = 37 // 1-basiert
  const KOST2_INDEX = 38

  const dataRows = invoices.map((inv) => {
    const gross = inv.amountGross ?? 0
    const belegDatum = inv.invoiceDate ?? inv.createdAt
    const buchungstext = `${inv.vendor}${inv.invoiceNumber ? ' ' + inv.invoiceNumber : ''}`.slice(0, 30)
    const fields = new Array<string>(DATA_ROW_FIELD_COUNT).fill('')
    fields[0] = amount(gross)
    fields[1] = datevText('H') // Konto = Sammel-Kreditorenkonto — Verbindlichkeit entsteht im Haben
    fields[2] = datevText(inv.currency && inv.currency !== 'EUR' ? inv.currency : '')
    // 4 Kurs, 5 Basis-Umsatz — keine Fremdwährungsumrechnung hinterlegt, bleiben leer
    fields[5] = datevText('') // WKZ Basis-Umsatz
    fields[6] = vendorAccounts[inv.vendor.trim().toLowerCase()] ?? settings.datevKreditorenkonto ?? ''
    fields[7] = settings.datevGegenkonto ?? ''
    fields[8] = datevText(guessBuKey(inv.amountNet, inv.amountTax))
    fields[9] = ddmm(belegDatum)
    fields[10] = datevText((inv.invoiceNumber ?? inv.docId ?? '').slice(0, 36))
    fields[11] = datevText(inv.docId ?? '')
    // 13 Skonto — kein Skonto-Betrag hinterlegt, bleibt leer
    fields[13] = datevText(buchungstext)
    // KOST1/KOST2 (Stefan 2026-08-26, vorher als "zu riskant ohne Spalten-
    // Bestätigung" ausgelassen — Position jetzt anhand einer DATEV-
    // Referenzimplementierung verifiziert).
    if (inv.costCenterCode) fields[KOST1_INDEX - 1] = datevText(inv.costCenterCode)
    if (inv.costCarrierCode) fields[KOST2_INDEX - 1] = datevText(inv.costCarrierCode)
    return fields.join(';')
  })

  return [headerRow, columnHeaderRow, ...dataRows].join('\r\n')
}

// Stefan 2026-08-26 ("Umlaute-Problem"): der Buchungsstapel MUSS als
// Windows-1252/ANSI kodiert sein, nicht UTF-8 — DATEV liest UTF-8 nur bei
// Debitoren-/Kreditoren-Stammdaten, nicht beim Buchungsstapel selbst (daher
// vorher die kaputten Umlaute trotz UTF-8-BOM, den es hier auch gar nicht
// braucht/geben darf). Node kennt "windows-1252" nicht als Buffer-Encoding,
// daher eine schlanke eigene Umsetzung: Zeichen 0x00–0x7F und 0xA0–0xFF
// stimmen 1:1 mit "latin1" überein (deckt alle deutschen Umlaute/ß ab),
// nur die Handvoll "cleveren" Unicode-Zeichen, die CP1252 statt der
// Steuerzeichen im Bereich 0x80–0x9F belegt (€, Anführungszeichen,
// Gedankenstrich …), brauchen eine explizite Zuordnung.
const CP1252_SPECIALS: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
}

/** Wandelt einen String in echte Windows-1252-Bytes um (siehe Kommentar oben).
 * Bewusst ohne Node-`Buffer` (nur Uint8Array) — läuft so unverändert sowohl
 * serverseitig (api/invoices/export/datev/route.ts) als auch im Browser
 * (DatevExportButton.tsx, verschlüsselte Mandanten bauen die CSV clientseitig).
 * Zeichen außerhalb von CP1252 (praktisch nie bei deutschen Geschäftstexten)
 * werden durch "?" ersetzt statt die Datei kaputt zu kodieren. */
export function toCp1252Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code <= 0xff && !(code >= 0x80 && code <= 0x9f)) {
      bytes[i] = code
    } else {
      bytes[i] = CP1252_SPECIALS[text[i]] ?? 0x3f // '?'
    }
  }
  return bytes
}

/** Liefert die Zeichen aus `text`, die `toCp1252Bytes` mangels CP1252-
 * Entsprechung stumm durch "?" ersetzen würde (z.B. kyrillische/chinesische
 * Zeichen in Lieferantennamen) — damit der Export den Verlust statt ihn zu
 * verschweigen. Dependency-frei aus demselben Grund wie `toCp1252Bytes`. */
export function findCp1252Losses(text: string): string[] {
  const lost = new Set<string>()
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const ok = (code <= 0xff && !(code >= 0x80 && code <= 0x9f)) || text[i] in CP1252_SPECIALS
    if (!ok) lost.add(text[i])
  }
  return Array.from(lost)
}
