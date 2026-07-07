// KI-gestützte Datenerkennung für gescannte (nicht-elektronische) Rechnungen.
// Nutzt den frei konfigurierbaren KI-Anbieter aus den Systemeinstellungen
// (OpenAI-kompatible Chat-Completions-API mit Bild-Eingabe, "image_url").
// Aufrufer MÜSSEN vorher prüfen: Mandant erlaubt KI (aiAllowed) UND hat KEINE
// Beleg-Verschlüsselung aktiv — sonst dürfte der Klartext nie an einen
// externen KI-Anbieter gehen (Zero-Knowledge). Siehe /api/ai/config und
// /api/invoices/ai-extract, die diese Prüfung serverseitig erzwingen.
import { getSettings } from '@/lib/settings'

export type AiExtractedInvoice = {
  vendor: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  dueDate: string | null
  amountNet: number | null
  amountTax: number | null
  amountGross: number | null
  currency: string | null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' || s.toLowerCase() === 'null' ? null : s
}

/** Prüft ohne Geheimnisse preiszugeben, ob systemweit ein KI-Anbieter konfiguriert ist. */
export async function isAiConfigured(): Promise<boolean> {
  const s = await getSettings()
  return Boolean(s.AI_BASE_URL && s.AI_MODEL)
}

/** Liest die Rechnungsdaten aus einem Foto/Scan per KI-Anbieter aus. */
export async function extractInvoiceFromImage(base64: string, mimeType: string): Promise<AiExtractedInvoice> {
  const s = await getSettings()
  if (!s.AI_BASE_URL || !s.AI_MODEL) {
    throw new Error('Kein KI-Anbieter konfiguriert (Systemeinstellungen).')
  }
  const url = s.AI_BASE_URL.replace(/\/$/, '') + '/chat/completions'
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(s.AI_API_KEY ? { Authorization: `Bearer ${s.AI_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: s.AI_MODEL,
        temperature: 0,
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content:
              'Du liest Rechnungen (Foto/Scan) und antwortest AUSSCHLIESSLICH mit kompaktem ' +
              'JSON, ohne Erklärung, ohne Markdown/Codeblock.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Extrahiere aus dieser Rechnung ein JSON-Objekt mit genau diesen Schlüsseln: ' +
                  'vendor (Name des Rechnungsstellers), invoiceNumber, invoiceDate (ISO yyyy-mm-dd), ' +
                  'dueDate (ISO yyyy-mm-dd oder null), amountNet (Zahl, Punkt als Dezimaltrennzeichen), ' +
                  'amountTax (Zahl), amountGross (Zahl), currency (ISO-Code, z. B. EUR). ' +
                  'Unbekannte Felder als null. Keine weiteren Felder, kein Zusatztext.',
              },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    })
  } catch {
    throw new Error('KI-Anbieter nicht erreichbar (Timeout/Netzwerk).')
  }
  if (!res.ok) {
    throw new Error(`KI-Anbieter antwortete mit Fehler ${res.status}.`)
  }
  const data = await res.json()
  const content: string = data?.choices?.[0]?.message?.content ?? ''
  const cleaned = content.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('KI-Antwort konnte nicht als Rechnungsdaten gelesen werden.')
  }
  return {
    vendor: str(parsed.vendor),
    invoiceNumber: str(parsed.invoiceNumber),
    invoiceDate: str(parsed.invoiceDate),
    dueDate: str(parsed.dueDate),
    amountNet: num(parsed.amountNet),
    amountTax: num(parsed.amountTax),
    amountGross: num(parsed.amountGross),
    currency: str(parsed.currency),
  }
}
