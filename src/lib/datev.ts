// DATEV-Export (Buchungsstapel, EXTF-Format) — Stefan 2026-07-08: erster
// Export-Weg für die Übergabe an die Finanzbuchhaltung. Bucht jede Rechnung
// mit dem Bruttobetrag auf ein Sammel-Kreditorenkonto gegen ein
// Sammel-Gegenkonto (siehe Tenant.datevKreditorenkonto/-Gegenkonto) — die
// weitere Kontierung je Lieferant bleibt bewusst Aufgabe der Fibu in DATEV
// selbst (Stefans Entscheidung: "Ein Sammelkonto für alle" statt eigener
// Lieferanten-Stammdaten mit Kontonummer je Kreditor).
//
// WICHTIG: Das DATEV-EXTF-Format ist umfangreich (in aktuellen Versionen
// 100+ mögliche Spalten) und ändert sich gelegentlich zwischen DATEV-
// Programmversionen. Diese Implementierung deckt die für einen einfachen
// Buchungsstapel nötigen Kernfelder ab (Spalten 1–14) und lässt weitere
// optionale Spalten weg — laut Spezifikation zulässig, eine Zeile darf nach
// der letzten belegten Spalte enden. Bitte den ERSTEN Export gemeinsam mit
// dem Steuerberater/der Fibu gegenprüfen, bevor er produktiv importiert wird.
//
// OFFEN (Stefan 2026-07-09, #114): Kostenstelle/Kostenträger (Invoice.
// costCenterCode/costCarrierCode) werden HIER BEWUSST NOCH NICHT eingebaut.
// Im EXTF-Buchungsstapel sind das die Felder "KOST1 - Kostenstelle" und
// "KOST2 - Kostenstelle", die in der DATEV-Spalten-Spezifikation erst nach
// Spalte 14 folgen (Positionsnummer je nach Version, u. a. um Spalte 45/46
// herum) — um sie korrekt zu platzieren, müssten alle dazwischenliegenden
// Spalten 15–44 mit definierten (ggf. leeren) Werten befüllt werden, sonst
// verschieben sich die Werte in der von der Fibu importierten Datei. Ohne
// Gegenprüfung anhand der aktuellen DATEV-Schnittstellen-Doku (oder mit dem
// Steuerberater) ist das Risiko einer stillen Fehlbuchung zu hoch, um es hier
// zu raten — bitte die genaue Spaltenposition für die verwendete DATEV-
// Version verifizieren, dann in buildDatevExport() ergänzen. Bis dahin sind
// Kostenstelle/Kostenträger nur in der Rechnung selbst und im freien
// CSV-Export (api/invoices/export) sichtbar, nicht im DATEV-Buchungsstapel.
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
}

export type DatevSettings = {
  datevBeraternr: string | null
  datevMandantnr: string | null
  datevSachkontenlaenge: number | null
  datevKreditorenkonto: string | null
  datevGegenkonto: string | null
  datevWjBeginn: string | null // TTMM
}

function csvField(v: string): string {
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function ddmm(d: Date): string {
  return String(d.getUTCDate()).padStart(2, '0') + String(d.getUTCMonth() + 1).padStart(2, '0')
}

function ddmmyyyy(d: Date): string {
  return (
    String(d.getUTCDate()).padStart(2, '0') +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCFullYear())
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
  const wjTag = settings.datevWjBeginn && /^\d{4}$/.test(settings.datevWjBeginn) ? settings.datevWjBeginn : '0101'
  const wjBeginn = `${wjTag}${minDate.getUTCFullYear()}`
  const sachkontenlaenge = settings.datevSachkontenlaenge ?? 4
  const erzeugtAm =
    `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}` +
    `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}000`

  const headerRow = [
    'EXTF', '700', '21', 'Buchungsstapel', '9',
    erzeugtAm, '', 'EI', csvField(meta.exportedBy.slice(0, 25)), '',
    settings.datevBeraternr ?? '', settings.datevMandantnr ?? '',
    wjBeginn, String(sachkontenlaenge),
    ddmmyyyy(minDate), ddmmyyyy(maxDate),
    csvField('E-Invoice Uebergabekorb'), '', '1', '', '0', 'EUR',
  ].join(';')

  const columnHeaderRow = [
    'Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs',
    'Basis-Umsatz', 'WKZ Basis-Umsatz', 'Konto', 'Gegenkonto (ohne BU-Schlüssel)',
    'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext',
  ].join(';')

  const dataRows = invoices.map((inv) => {
    const gross = inv.amountGross ?? 0
    const belegDatum = inv.invoiceDate ?? inv.createdAt
    const buchungstext = `${inv.vendor}${inv.invoiceNumber ? ' ' + inv.invoiceNumber : ''}`.slice(0, 30)
    return [
      amount(gross),
      'H', // Konto = Sammel-Kreditorenkonto — Verbindlichkeit entsteht im Haben
      inv.currency && inv.currency !== 'EUR' ? inv.currency : '',
      '', '', '',
      vendorAccounts[inv.vendor.trim().toLowerCase()] ?? settings.datevKreditorenkonto ?? '',
      settings.datevGegenkonto ?? '',
      guessBuKey(inv.amountNet, inv.amountTax),
      ddmm(belegDatum),
      csvField((inv.invoiceNumber ?? inv.docId ?? '').slice(0, 36)),
      csvField(inv.docId ?? ''),
      '',
      csvField(buchungstext),
    ].join(';')
  })

  return '﻿' + [headerRow, columnHeaderRow, ...dataRows].join('\r\n')
}
