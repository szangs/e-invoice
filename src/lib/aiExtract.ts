// KI-gestützte Datenerkennung für gescannte (nicht-elektronische) Rechnungen.
// Nutzt den frei konfigurierbaren KI-Anbieter aus den Systemeinstellungen
// (OpenAI-kompatible Chat-Completions-API mit Bild-Eingabe, "image_url").
// Aufrufer MÜSSEN vorher prüfen: Mandant erlaubt KI (aiAllowed) UND hat KEINE
// Beleg-Verschlüsselung aktiv — sonst dürfte der Klartext nie an einen
// externen KI-Anbieter gehen (Zero-Knowledge). Siehe /api/ai/config und
// /api/invoices/ai-extract, die diese Prüfung serverseitig erzwingen.
import { ApiError } from '@/lib/context'
import { addAiTokenUsage, getSettings } from '@/lib/settings'

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
  // Spam-/Nicht-Rechnung-Erkennung beim Mail-Eingang (Stefan 2026-08-25):
  // dieselbe KI-Antwort liefert zusätzlich eine Einschätzung, ob das
  // Dokument überhaupt eine Rechnung ist — vermeidet einen zweiten,
  // separaten API-Call nur für die Klassifikation. Siehe lib/mailin.ts.
  documentType: 'invoice' | 'not_invoice' | 'unsure'
  // Sicherheit dieser Einstufung in Prozent (Stefan 2026-08-25, 0-100) — wie
  // sicher sich das Modell ist, dass documentType korrekt ist. Landet im
  // Spam/Fehlleitung-Korb sichtbar in der Rechnungsliste (InvoiceRows.tsx),
  // damit ein Mensch nicht blind vertrauen muss.
  documentTypeConfidence: number | null
  // Positionszeilen (Stefan 2026-08-25): bei nackten PDFs/Scans ohne
  // strukturiertes XML war bisher nur die Gesamtsumme sichtbar — bei
  // Rechnungen mit vielen Posten fehlte die Aufschlüsselung komplett.
  // Best-effort, kann leer bleiben (z. B. bei schlecht lesbarem Beleg).
  lines: { name: string; qty: string | null; unitPrice: number | null; discount: number | null; total: number | null }[]
  // Skonto (Stefan 2026-08-25): dueDate oben ist IMMER das eigentliche
  // Zahlungsziel (netto, ohne Abzug) — vorher konnte die KI hier
  // versehentlich die kürzere Skonto-Frist statt des Zahlungsziels
  // zurückgeben, wenn auf der Rechnung beides steht (z. B. "2 % Skonto
  // innerhalb 7 Tagen, netto innerhalb 30 Tagen"). Skonto-Frist und -Satz
  // jetzt separat, damit beide Angaben erhalten bleiben statt verwechselt zu werden.
  discountDueDate: string | null
  discountPercent: number | null
  // Anschrift/Steuerkennung des Lieferanten (Stefan 2026-08-25, §14 Abs. 4
  // Nr. 1+2 UStG) — bei E-Rechnung strukturiert aus dem XML, bei PDF/Scan
  // vorher gar nicht erfasst. Best-effort: steht oft klein im Briefkopf/
  // Footer, die KI liest es mit, wenn erkennbar, sonst null (von Hand nachtragbar).
  sellerAddress: string | null
  sellerVatId: string | null
  sellerTaxNumber: string | null
  // Land des Lieferanten (Stefan 2026-08-25, ISO 3166-1 alpha-2, z. B. "DE",
  // "FR", "US") — Grundlage für die Inland/EU/Drittland-Einordnung
  // (lib/erechnung.ts classifyTaxRegion), die wiederum bestimmt, welche
  // Pflichtangaben-Regel gilt. Nur wenn erkennbar, sonst null (dann fragt die
  // Anzeige den Menschen statt zu raten).
  sellerCountryCode: string | null
}

const KNOWN_FIELDS = [
  'vendor', 'invoiceNumber', 'invoiceDate', 'dueDate',
  'sellerAddress', 'sellerVatId', 'sellerTaxNumber', 'sellerCountryCode',
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
export async function extractInvoiceFromImage(
  base64: string,
  mimeType: string,
  // Lieferanten-Gedächtnis (Stefan 2026-08-25, lib/vendorMemory.ts): Hinweis
  // auf eine frühere, bereits geprüfte Rechnung DESSELBEN Absenders — macht
  // die Erkennung konsistenter (z. B. immer dieselbe Lieferanten-Schreibweise),
  // ohne dass Beträge/Datum/Rechnungsnummer aus der Vergangenheit übernommen
  // werden (die liest die KI weiterhin eigenständig aus DIESEM Beleg).
  vendorHint?: string,
): Promise<AiExtractedInvoice> {
  const s = await getSettings()
  if (!s.AI_BASE_URL || !s.AI_MODEL) {
    throw new ApiError(400, 'Kein KI-Anbieter konfiguriert (Systemeinstellungen).')
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
        // 2000 statt knapp bemessener 500 (Stefan 2026-08-25): "denkende"
        // Modelle (z. B. Gemini 3.x) verbrauchen einen Teil von max_tokens
        // für unsichtbare interne Reasoning-Tokens, die nicht im sichtbaren
        // content erscheinen aber trotzdem gegen das Limit zählen — bei 500
        // riss die JSON-Antwort mitten im Feld ab (finish_reason "length").
        max_tokens: 2000,
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
                  'dueDate (ISO yyyy-mm-dd oder null — WICHTIG: das eigentliche Zahlungsziel OHNE ' +
                  'Skonto-Abzug, z. B. bei "2 % Skonto innerhalb 7 Tagen, netto innerhalb 30 Tagen" ' +
                  'IMMER das 30-Tage-Datum, NIEMALS das kürzere Skonto-Datum), ' +
                  'discountDueDate (ISO yyyy-mm-dd oder null — die separate, KÜRZERE Skonto-Frist aus ' +
                  'demselben Beispiel das 7-Tage-Datum, nur wenn ein Skonto-Rabatt für vorzeitige ' +
                  'Zahlung ausdrücklich genannt ist, sonst null), ' +
                  'discountPercent (Zahl oder null — der Skonto-Prozentsatz, z. B. 2 für "2 % Skonto"), ' +
                  'sellerAddress (vollständige Anschrift des Rechnungsstellers als ein String, ' +
                  'z. B. "Musterstraße 12, 12345 Musterstadt" — nur wenn auf der Rechnung erkennbar, ' +
                  'sonst null, NICHT raten), ' +
                  'sellerVatId (Umsatzsteuer-Identifikationsnummer des Rechnungsstellers, Format ' +
                  'meist "DE123456789" o. ä. — nur wenn ausdrücklich als USt-IdNr./VAT-ID/Ust-Id ' +
                  'bezeichnet, sonst null), ' +
                  'sellerTaxNumber (Steuernummer des Rechnungsstellers, z. B. "123/456/78901" — nur ' +
                  'wenn ausdrücklich als Steuernummer/Steuer-Nr. bezeichnet, NICHT dieselbe wie eine ' +
                  'USt-IdNr., sonst null), ' +
                  'sellerCountryCode (Land des Rechnungsstellers als ISO-3166-1-alpha-2-Code, z. B. ' +
                  '"DE", "FR", "US", "CH" — leite ihn aus JEDEM eindeutigen Hinweis ab: der Anschrift, ' +
                  'dem Länder-Präfix der USt-IdNr./Steuernummer (z. B. "CHE-..." → CH), ODER einem ' +
                  'ausgeschriebenen Ländernamen irgendwo auf dem Beleg (z. B. steht dort wörtlich ' +
                  '"Switzerland", "Schweiz", "United States", "France" → den passenden Code verwenden, ' +
                  'das ist KEIN Raten, sondern Übersetzen eines klar erkennbaren Ländernamens in seinen ' +
                  'Code). Nur wenn WIRKLICH nirgends ein Land erkennbar ist: null), ' +
                  'amountNet (Zahl, Punkt als Dezimaltrennzeichen), ' +
                  'amountTax (Zahl), amountGross (Zahl), currency (ISO-Code, z. B. EUR), ' +
                  'tags (1 bis 3 kurze, kommagetrennte Kategorie-Schlagworte passend zur Rechnung, ' +
                  'z. B. "Büromaterial", "Reisekosten", "Software", "Miete", "Werbung" — als EIN ' +
                  'String mit Kommas, kein Array), directDebitByVendor (true NUR wenn im Text klar ' +
                  'steht, dass der Rechnungssteller den Betrag selbst per Lastschrift/SEPA-Lastschrift/' +
                  'Einzugsermächtigung/Bankeinzug vom Konto des Kunden abbucht, sonst false — bei ' +
                  'reiner Angabe von IBAN/Überweisungsdaten ohne Lastschrift-Hinweis: false), ' +
                  'unsureFields (Array mit den Schlüsseln oben, bei denen du dir UNSICHER bist, ' +
                  'z. B. wegen Unschärfe, Abschneidung, schlechter Lesbarkeit oder Mehrdeutigkeit — ' +
                  'leeres Array wenn alles klar lesbar war), documentType (EXAKT einer der drei Werte ' +
                  '"invoice" wenn das Bild eindeutig eine Rechnung/einen Zahlungsbeleg zeigt, ' +
                  '"not_invoice" wenn es eindeutig KEINE Rechnung ist — z. B. Newsletter, Werbung, ' +
                  'Vertrag, Bewerbungsschreiben, Spam, Screenshot ohne Rechnungsbezug — oder ' +
                  '"unsure" wenn nicht eindeutig erkennbar), documentTypeConfidence (ganze Zahl 0-100 — ' +
                  'wie sicher du dir bei documentType bist, 100 = völlig eindeutig, 50 = reine Vermutung), ' +
                  'lines (Array der einzelnen ' +
                  'Rechnungspositionen/Posten, falls als Tabelle/Liste erkennbar — je Position ein ' +
                  'Objekt mit name (Bezeichnung), qty (Menge als Text, z. B. "3" oder "2 Stück", ' +
                  'oder null), unitPrice (Einzelpreis als Zahl oder null — falls nicht separat ' +
                  'aufgeführt, aus Menge/Rabatt/Betrag zurückrechnen), discount (Rabatt/Nachlass ' +
                  'DIESER Position als positive Zahl, falls in einer eigenen Spalte ausgewiesen, ' +
                  'sonst null — NICHT mit dem allgemeinen Skonto der Gesamtrechnung verwechseln), ' +
                  'total (Zeilensumme NACH Abzug des Rabatts als Zahl oder null) — leeres Array wenn ' +
                  'keine einzelnen Positionen erkennbar sind, z. B. ' +
                  'bei einer Pauschalrechnung ohne Aufschlüsselung). ' +
                  'Unbekannte Felder als null. Keine weiteren Felder, kein Zusatztext.' +
                  (vendorHint ? `\n\n${vendorHint}` : ''),
              },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
      }),
      // 60s statt vorher 30s (Stefan 2026-08-25): eine Bild-Anfrage mit
      // max_tokens 2000 an ein "denkendes" Modell (siehe Kommentar oben)
      // braucht spürbar länger als eine reine Text-Anfrage — 30s riss live
      // beobachtet regelmäßig mitten in der Antwort ab.
      signal: AbortSignal.timeout(60000),
    })
  } catch {
    throw new ApiError(502, 'KI-Anbieter nicht erreichbar (Timeout/Netzwerk).')
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
    // res.status 1:1 durchreichen (Stefan 2026-08-25): so kommt z. B. ein
    // Rate-Limit (429) auch als 429 beim Nutzer an, statt in der generischen
    // "Interner Fehler"-500-Antwort unterzugehen (jsonError kennt nur
    // ApiError/ZodError speziell, alles andere wird zu 500 ohne Detailtext).
    throw new ApiError(res.status, `KI-Anbieter antwortete mit Fehler ${res.status}${detail ? `: ${detail.slice(0, 300)}` : '.'}${hint}`)
  }
  const data = await res.json()
  // Tokenverbrauch aufaddieren (Stefan 2026-08-25, Systemeinstellungen) —
  // best effort, kein harter Fehler falls der Anbieter keine usage liefert.
  addAiTokenUsage(Number(data?.usage?.total_tokens) || 0).catch(() => undefined)
  const content: string = data?.choices?.[0]?.message?.content ?? ''
  const cleaned = content.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new ApiError(502, 'KI-Antwort konnte nicht als Rechnungsdaten gelesen werden.')
  }
  const vendor = str(parsed.vendor)
  const invoiceNumber = str(parsed.invoiceNumber)
  const invoiceDate = str(parsed.invoiceDate)
  const dueDate = str(parsed.dueDate)
  const discountDueDate = str(parsed.discountDueDate)
  const discountPercent = num(parsed.discountPercent)
  const sellerAddress = str(parsed.sellerAddress)
  const sellerVatId = str(parsed.sellerVatId)
  const sellerTaxNumber = str(parsed.sellerTaxNumber)
  const sellerCountryCode = str(parsed.sellerCountryCode)
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

  // KI-Angabe übernehmen, aber gegen die eigenen Kernfelder absichern: eine
  // als "invoice" gemeldete Erkennung ohne Betrag UND ohne Lieferant ist
  // widersprüchlich (z. B. Modell "rät" den Dokumenttyp ohne echte Grundlage)
  // — dann lieber "unsure" als fälschlich vertrauenswürdig einstufen.
  const rawDocType = String(parsed.documentType ?? '').trim().toLowerCase()
  const documentType: AiExtractedInvoice['documentType'] =
    rawDocType === 'not_invoice'
      ? 'not_invoice'
      : rawDocType === 'invoice' && (amountGross !== null || vendor)
        ? 'invoice'
        : 'unsure'
  const rawConfidence = Number(parsed.documentTypeConfidence)
  const documentTypeConfidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(100, Math.round(rawConfidence))) : null

  const lines: AiExtractedInvoice['lines'] = Array.isArray(parsed.lines)
    ? parsed.lines
        .filter((l: unknown): l is Record<string, unknown> => typeof l === 'object' && l !== null)
        .map((l: Record<string, unknown>) => ({
          name: str(l.name) ?? '(ohne Bezeichnung)',
          qty: str(l.qty),
          unitPrice: num(l.unitPrice),
          discount: num(l.discount),
          total: num(l.total),
        }))
    : []

  return {
    vendor,
    invoiceNumber,
    invoiceDate,
    dueDate,
    discountDueDate,
    discountPercent,
    sellerAddress,
    sellerVatId,
    sellerTaxNumber,
    sellerCountryCode,
    amountNet,
    amountTax,
    amountGross,
    currency,
    tags,
    directDebitByVendor,
    uncertainFields: Array.from(flagged),
    warnings,
    documentType,
    documentTypeConfidence,
    lines,
  }
}
