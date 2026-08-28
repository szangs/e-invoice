// GiroCode/EPC-QR-Zahlungscode aus einem gescannten Beleg auslesen (Stefan
// 2026-08-27, "die Möglichkeit einkalkulieren, dass der Beleg schon einen
// QR-Code hat") — viele deutsche Rechnungen tragen bereits einen
// GiroCode/EPC-QR-Code (EPC069-12-Norm, von Banking-Apps zum
// Blitzüberweisen genutzt) mit strukturierten Zahlungsdaten (IBAN/BIC/
// Empfänger/Betrag/Verwendungszweck) — zuverlässiger als OCR/KI-Schätzung,
// wenn vorhanden. Rein clientseitig (jsQR) — kein Bild verlässt für diesen
// Schritt den Browser.
import jsQR from 'jsqr'

export type GiroCodeData = {
  bic: string | null
  creditorName: string | null
  iban: string | null
  amount: number | null
  currency: string | null
  reference: string | null // strukturierter Verwendungszweck (Creditor Reference, ISO 11649)
  remittanceInfo: string | null // unstrukturierter Verwendungszweck (Freitext)
}

/** Liest den rohen Text eines QR-Codes aus einer Bilddatei — null, wenn keiner gefunden wird oder die Datei kein Bild ist. */
export async function decodeQrFromImage(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const result = jsQR(imageData.data, imageData.width, imageData.height)
    return result?.data ?? null
  } finally {
    bitmap.close()
  }
}

/**
 * EPC069-12 ("GiroCode") parsen — null, wenn der Text kein gültiger
 * Zahlungs-QR-Code ist (z. B. ein ganz anderer QR-Code auf dem Beleg, ein
 * Produkt-/Werbe-QR-Code, oder gar keiner gefunden). Zeilen laut Norm
 * (1-basiert): 1=BCD, 2=Version, 3=Zeichensatz, 4=Kennung ("SCT"), 5=BIC,
 * 6=Empfängername, 7=IBAN, 8=Betrag (z. B. "EUR119.00"), 9=Zweck,
 * 10=strukturierter Verwendungszweck, 11=unstrukturierter Verwendungszweck.
 */
export function parseGiroCode(text: string): GiroCodeData | null {
  const lines = text.split(/\r\n|\r|\n/)
  if (lines[0]?.trim() !== 'BCD') return null
  const get = (i: number): string | null => lines[i]?.trim() || null

  const amountRaw = get(7)
  let amount: number | null = null
  let currency: string | null = null
  if (amountRaw) {
    const m = /^([A-Z]{3})(\d+(?:[.,]\d{1,2})?)$/.exec(amountRaw)
    if (m) {
      currency = m[1]
      amount = Number(m[2].replace(',', '.'))
    }
  }

  const iban = get(6)
  // Grobe Plausibilität statt vollständiger IBAN-Prüfziffer-Berechnung hier
  // (die gibt es schon in lib/sepa.ts isValidIban, aber das ist eine reine
  // Server-Datei) — ein "BCD"-Kopf ohne halbwegs IBAN-förmigen Inhalt ist
  // eher ein zufällig ähnlich strukturierter, fremder QR-Code.
  if (!iban || !/^[A-Z]{2}[0-9A-Z]{13,32}$/.test(iban.replace(/\s+/g, ''))) return null

  return {
    bic: get(4),
    creditorName: get(5),
    iban: iban.replace(/\s+/g, ''),
    amount,
    currency,
    reference: get(9),
    remittanceInfo: get(10),
  }
}
