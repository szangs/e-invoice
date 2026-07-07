// Leichtgewichtige Format-Metadaten OHNE die schweren Parser-Abhängigkeiten
// von lib/erechnung.ts (pdf-lib, fast-xml-parser) — dieses Modul wird auch
// von Client-Komponenten importiert (InvoiceEditForm.tsx, invoices/new/
// page.tsx), um zu entscheiden, ob KI-Erkennung angeboten wird. erechnung.ts
// re-exportiert dieselben Werte für serverseitige Nutzung (ein
// Wahrheits-Ort).
export type DocFormat = 'ZUGFERD' | 'XRECHNUNG_CII' | 'XRECHNUNG_UBL' | 'PDF' | 'OTHER'

// E-Rechnungsformate mit bereits strukturiert erkannten Daten (XML) — für
// diese wird KEINE KI-Erkennung angeboten (Daten sind schon maschinenlesbar
// vorhanden, eine KI-Bilderkennung wäre redundant und könnte sogar
// widersprüchliche Werte liefern).
export const EINVOICE_FORMATS: DocFormat[] = ['ZUGFERD', 'XRECHNUNG_CII', 'XRECHNUNG_UBL']

export const FORMAT_LABELS: Record<DocFormat, string> = {
  ZUGFERD: 'ZUGFeRD / Factur-X',
  XRECHNUNG_CII: 'XRechnung (CII)',
  XRECHNUNG_UBL: 'XRechnung (UBL)',
  PDF: 'PDF (ohne strukturierte Daten)',
  OTHER: 'Unbekanntes Format',
}
