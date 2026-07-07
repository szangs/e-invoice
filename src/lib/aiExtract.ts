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
  tags: string | null
  // Erkannt aus Formulierungen wie "wir buchen den Betrag per Lastschrift/
  // SEPA-Lastschrift/Einzugsermächtigung von Ihrem Konto ab" — true nur bei
  // klarem Hinweis, sonst null (nicht raten).
  directDebitByVendor: boolean | null
  // Qualitätsabschätzung: Feldnamen, die besonders geprüft werden sollten —
  // teils von der KI selbst als unsicher gemeldet, teils durch eigene
  // Plausibilitätsprüfung (Beträge, Datum) ermittelt — plus menschenlesbare
  // Begründung(en) dazu.
  uncertainFields: string[]
  warnings: string[]
}

const KNOWN_FIELDS = [
  'vendor', 'invoiceNumber', 'invoiceDate', 'dueDate',
  'amountNet', 'amountTax', 'amountGross', 'currency', 'tags', 'directDebitByVendor',
]

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

function bool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (v === null || v === undefined) return null
  const s = String(v).trim().toLowerCase()
  if (s === 'true') return true
  if (s === 'false') return false
  return null
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
                  'amountTax (Zahl), amountGross (Zahl), currency (ISO-Code, z. B. EUR), ' +
                  'tags (1 bis 3 kurze, kommagetrennte Kategorie-Schlagworte passend zur Rechnung, ' +
                  'z. B. "Büromaterial", "Reisekosten", "Software", "Miete", "Werbung" — als EIN ' +
                  'String mit Kommas, kein Array), directDebitByVendor (true NUR wenn im Text klar ' +
                  'steht, dass der Rechnungssteller den Betrag selbst per Lastschrift/SEPA-Lastschrift/' +
                  'Einzugsermächtigung/Bankeinzug vom Konto des Kunden abbucht, sonst false — bei ' +
                  'reiner Angabe von IBAN/Überweisungsdaten ohne Lastschrift-Hinweis: false), ' +
                  'unsureFields (Array mit den Schlüsseln oben, bei denen du dir UNSICHER bist, ' +
                  'z. B. wegen Unschärfe, Abschneidung, schlechter Lesbarkeit oder Mehrdeutigkeit — ' +
                  'leeres Array wenn alles klar lesbar war). ' +
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
    // Fehlertext des Anbieters mitgeben (z. B. "model does not support images") —
    // sonst ist ein 400 kaum einzugrenzen (falsches Modell, falsches Feldformat, …).
    const bodyText = await res.text().catch(() => '')
    let detail = bodyText
    try {
      const parsed = JSON.parse(bodyText)
      detail = parsed?.error?.message ?? parsed?.message ?? bodyText
    } catch {
      /* kein JSON — Rohtext verwenden */
    }
    const looksLikeNoVision = /content must be a string|does not support image|image_url|vision|multimodal/i.test(detail)
    const hint = looksLikeNoVision
      ? ' — das konfigurierte KI-Modell unterstützt vermutlich keine Bild-Eingabe (Vision). ' +
        'Bitte in den Systemeinstellungen ein Vision-fähiges Modell eintragen (Verbindungstest ' +
        'zeigt jetzt die beim Anbieter verfügbaren Modelle an).'
      : ''
    throw new Error(`KI-Anbieter antwortete mit Fehler ${res.status}${detail ? `: ${detail.slice(0, 300)}` : '.'}${hint}`)
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
  const vendor = str(parsed.vendor)
  const invoiceNumber = str(parsed.invoiceNumber)
  const invoiceDate = str(parsed.invoiceDate)
  const dueDate = str(parsed.dueDate)
  const amountNet = num(parsed.amountNet)
  const amountTax = num(parsed.amountTax)
  const amountGross = num(parsed.amountGross)
  const currency = str(parsed.currency)
  const tags = str(parsed.tags)
  const directDebitByVendor = bool(parsed.directDebitByVendor)

  // Von der KI selbst gemeldete Unsicherheiten (nur bekannte Feldnamen übernehmen)
  const aiUnsure: string[] = Array.isArray(parsed.unsureFields)
    ? parsed.unsureFields.filter((f: unknown): f is string => typeof f === 'string' && KNOWN_FIELDS.includes(f))
    : []
  const flagged = new Set(aiUnsure)
  const warnings: string[] = []
  if (aiUnsure.length > 0) {
    warnings.push(`KI war sich bei folgenden Feldern unsicher: ${aiUnsure.join(', ')}.`)
  }

  // Eigene, deterministische Plausibilitätsprüfung (unabhängig vom KI-Anbieter)
  if (amountNet !== null && amountTax !== null && amountGross !== null) {
    if (Math.abs(amountNet + amountTax - amountGross) > 0.02) {
      warnings.push('Netto + Steuer ergibt nicht den Bruttobetrag — bitte Beträge prüfen.')
      flagged.add('amountNet')
      flagged.add('amountTax')
      flagged.add('amountGross')
    }
  } else if (amountGross === null) {
    warnings.push('Kein Bruttobetrag erkannt.')
    flagged.add('amountGross')
  }
  if (!vendor) {
    warnings.push('Kein Lieferant erkannt.')
    flagged.add('vendor')
  }
  if (!invoiceDate) {
    warnings.push('Kein Rechnungsdatum erkannt.')
    flagged.add('invoiceDate')
  } else {
    const d = new Date(invoiceDate)
    if (Number.isNaN(d.getTime())) {
      warnings.push('Rechnungsdatum ist kein gültiges Datum.')
      flagged.add('invoiceDate')
    } else if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      warnings.push('Rechnungsdatum liegt in der Zukunft — bitte prüfen.')
      flagged.add('invoiceDate')
    }
  }

  return {
    vendor,
    invoiceNumber,
    invoiceDate,
    dueDate,
    amountNet,
    amountTax,
    amountGross,
    currency,
    tags,
    directDebitByVendor,
    uncertainFields: Array.from(flagged),
    warnings,
  }
}
