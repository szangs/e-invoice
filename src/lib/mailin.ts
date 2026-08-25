// E-Mail-Eingang: zwei Zustellwege teilen sich dieselbe Verarbeitung
// (processInboundAttachments) — W1/W2 per eigenem SMTP-Empfänger auf der
// Subdomain (scripts/smtp-server.ts, Catch-All, Mandanten-Auflösung über die
// Empfängeradresse) und alternativ per Microsoft Graph (scripts/graph-mailin-poller.ts,
// src/lib/graphMailin.ts, Mandant ist beim Polling bereits über die Tenant-Konfiguration
// bekannt — kein Adress-Parsing nötig). IMAP-Postfachabruf wurde am 2026-07-08 auf
// Stefans Wunsch entfernt. Absender-Beschränkung gilt für beide Wege: global
// (MAIL_IN_ALLOWED_DOMAINS) und je Mandant (mailAllowedDomains). Hinweis:
// E-Mail-Eingang ist prinzipbedingt nicht Ende-zu-Ende-verschlüsselbar.
import { InvoiceStatus, type Tenant } from '@prisma/client'
import { type AddressObject, type ParsedMail } from 'mailparser'
import { type AiExtractedInvoice, extractInvoiceFromImage, isAiConfigured } from '@/lib/aiExtract'
import { audit } from '@/lib/audit'
import { ensureSystemBaskets } from '@/lib/baskets'
import { prisma } from '@/lib/db'
import { nextDocId } from '@/lib/docId'
import { detectDuplicate, hashBuffer } from '@/lib/duplicates'
import { analyzeInvoiceFile, autoElectronicCheck } from '@/lib/erechnung'
import { renderHtmlToPdf } from '@/lib/htmlToPdf'
import { hasFeature } from '@/lib/license'
import { sendSystemMail } from '@/lib/mail'
import { extractFirstPageText, rasterizeFirstPage } from '@/lib/pdfRaster'
import { getSettings, isDevMode } from '@/lib/settings'
import { ALLOWED_MIME, MAX_FILE_BYTES, saveInvoiceFile } from '@/lib/storage'

// Spam-/Nicht-Rechnung-Klassifikation ohne KI (Stefan 2026-08-25): reine
// Stichwort-Heuristik als Rückfallebene, wenn kein KI-Anbieter konfiguriert
// oder für den Mandanten erlaubt ist. Bewusst VORSICHTIG bei "NOT_INVOICE":
// nur wenn ein klares Spam-/Werbe-Signal vorliegt UND GAR KEIN Rechnungs-
// Hinweis (weder Schlüsselwort noch Betrag) — eine Heuristik ohne echtes
// Sprachverständnis ist sonst zu unzuverlässig für einen Hard-Reject.
const INVOICE_KEYWORDS = /\b(rechnung|invoice|faktura|betrag|gesamtbetrag|summe|zahlbar|fällig|iban|ust-id|umsatzsteuer|mwst|vat|total due|amount due)\b/i
// Betrags-Muster bewusst allgemein gehalten (jeder 3-Buchstaben-Code, nicht
// nur EUR/USD/GBP) — sonst würden Auslandsrechnungen in Fremdwährung (CHF,
// NOK, …) fälschlich als "unsicher" statt "Rechnung" eingestuft.
const AMOUNT_PATTERN = /\d[.,]\d{2}\s*(€|\$|£|[a-z]{3}\b)/i
// Typische Werbe-/Newsletter-Formulierungen — nur zusammen mit VOLLSTÄNDIGER
// Abwesenheit jedes Rechnungs-Hinweises als Spam-Signal gewertet (s. o.).
const SPAM_KEYWORDS = /\b(gewinnspiel|rabattcode|sonderangebot|exklusives angebot|jetzt klicken|klicken sie hier|newsletter abbestellen|vom newsletter abmelden|unsubscribe|nur heute|limited time offer|click here|special offer)\b/i
// Mail bezieht sich nur auf eine BEREITS erledigte Rechnung (Zahlungs-
// bestätigung, Quittung o. Ä.) — keine neue, offene Forderung, auch wenn
// Betrag/Rechnungswort vorkommen. Genau der Fall "Info zu bestehender
// Rechnung, versehentlich an den Rechnungseingang gesendet".
const ALREADY_SETTLED_PATTERN = /\b(bereits (beglichen|bezahlt|erhalten)|wurde beglichen|zahlungseingang bestätigt|zahlungsbestätigung|kein(e)? weitere[rn]? (aktion|handlungsbedarf)|payment (received|confirmed)|already (paid|settled))\b/i

function classifyByKeywords(text: string): 'INVOICE' | 'UNCERTAIN' | 'NOT_INVOICE' {
  if (ALREADY_SETTLED_PATTERN.test(text)) return 'UNCERTAIN'
  const hasInvoiceSignal = INVOICE_KEYWORDS.test(text)
  const hasAmount = AMOUNT_PATTERN.test(text)
  if (hasInvoiceSignal && hasAmount) return 'INVOICE'
  if (SPAM_KEYWORDS.test(text) && !hasInvoiceSignal && !hasAmount) return 'NOT_INVOICE'
  return 'UNCERTAIN'
}

/**
 * Automatische Antwort an den Absender bei Spam-Verdacht (Stefan 2026-08-25,
 * Tenant.spamReplyEnabled — bewusst risikobehaftetes Feature, siehe Kommentar
 * am Schema-Feld): informiert, dass die Mail nicht als Rechnung erkannt und
 * daher NICHT in die Rechnungsbearbeitung übernommen wurde. Keine Antwort an
 * offensichtliche Automat-/Rückläufer-Adressen (mindert das Backscatter-
 * Risiko etwas, schützt aber NICHT vor gefälschten Absenderadressen — dafür
 * gibt es keinen technischen Schutz auf dieser Ebene).
 */
const AUTOMATED_SENDER = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce)/i

async function sendSpamNotice(tenant: Pick<Tenant, 'name'>, from: string, subject: string, invoiceId: string): Promise<void> {
  // Im Entwicklermodus NIE an echte Absender senden (Stefan 2026-08-25) —
  // genau in diesem Modus laufen Testrechnungen/Demo-Läufe (z. B.
  // "Testrechnungen senden"), oft mit echten oder echt aussehenden
  // Absenderadressen. Eine "harmlose" automatische Antwort dorthin wäre beim
  // Testen genau die ungewollte reale Mail nach außen, die dieser Schalter
  // sonst überall sonst verhindert (siehe isDevMode-Nutzung in graphMailin.ts).
  if (await isDevMode()) return
  const local = from.split('@')[0] ?? ''
  if (AUTOMATED_SENDER.test(local)) return
  try {
    // sendSystemMail wirft bei Fehlern NICHT — liefert {sent:false, reason}
    // zurück (Provider nicht konfiguriert, SMTP-Fehler …). Nur bei sent=true
    // als verschickt markieren, sonst würde ein tatsächlich fehlgeschlagener
    // Versand fälschlich als erledigt gelten und nie wiederholt.
    const result = await sendSystemMail(
      from,
      `Automatische Antwort: Ihre E-Mail an ${tenant.name} wurde nicht als Rechnung erkannt`,
      `Dies ist eine automatische Antwort.\n\n` +
        `Ihre E-Mail mit dem Betreff "${subject}" ging an eine Adresse, die ausschließlich für den ` +
        `automatisierten Rechnungseingang von ${tenant.name} vorgesehen ist. Der Inhalt wurde nicht als ` +
        `Rechnung erkannt und daher NICHT in die Rechnungsbearbeitung übernommen.\n\n` +
        `Falls es sich tatsächlich um eine Rechnung handelt, wenden Sie sich bitte direkt an Ihren ` +
        `Ansprechpartner bei ${tenant.name} über einen anderen Kontaktweg — diese Adresse wird nicht von ` +
        `Mitarbeitern gelesen.\n\n` +
        `Diese Nachricht wurde automatisch erzeugt, bitte nicht direkt darauf antworten.`,
    )
    if (result.sent) {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { spamReplySentAt: new Date() } })
    } else {
      console.error('Automatische Spam-Antwort fehlgeschlagen:', result.reason)
    }
  } catch (e) {
    console.error('Automatische Spam-Antwort fehlgeschlagen:', e instanceof Error ? e.message : e)
  }
}

/** Grobe HTML→Klartext-Umwandlung für die Anzeige des Mailtexts (Stefan 2026-08-25) — keine vollwertige HTML-Bibliothek nötig, nur lesbarer Fließtext statt roher Tags. */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function addressList(value: AddressObject | AddressObject[] | undefined): string[] {
  if (!value) return []
  const arr = Array.isArray(value) ? value : [value]
  return arr.flatMap((a) => a.value.map((v) => (v.address ?? '').toLowerCase())).filter(Boolean)
}

function domainOf(address: string): string {
  return address.split('@')[1]?.toLowerCase() ?? ''
}

/** Prüft Absender gegen kommagetrennte Domänenliste (leer = alle erlaubt). */
function domainAllowed(from: string, list: string | null | undefined): boolean {
  const allowed = (list ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
  if (allowed.length === 0) return true
  const d = domainOf(from)
  return allowed.some((a) => d === a || d.endsWith('.' + a))
}

export type InboundAttachment = { filename?: string; contentType: string; content: Buffer }

/**
 * Verarbeitet die Anhänge einer bereits einem Mandanten zugeordneten Mail:
 * Absender-Prüfung, Beleg-Anlage, Protokollierung. Gemeinsamer Kern für den
 * SMTP-Weg (handleParsedMail, unten) und den Graph-Weg (graphMailin.ts) —
 * beide unterscheiden sich nur darin, WIE Mandant/Anhänge ermittelt werden.
 * `sourceMessageId` (nur Graph): Nachrichten-ID, für Dublettenprüfung beim
 * nächsten Poll in den MailIntake-Zeilen mitgespeichert.
 */
export async function processInboundAttachments(
  tenant: Pick<Tenant, 'id' | 'name' | 'mailAllowedDomains' | 'aiAllowed' | 'licensePlan' | 'licenseExpiresAt' | 'spamReplyEnabled'>,
  from: string,
  toAddress: string,
  subject: string,
  attachments: InboundAttachment[],
  via: 'SMTP' | 'GRAPH',
  sourceMessageId?: string,
  // HTML-/Text-Mailtext als Rückfallebene, wenn kein verwertbarer Anhang da
  // ist (Stefan 2026-08-25): manche Auslands-/Drittland-Lieferanten schicken
  // die Rechnung direkt als HTML-Mailtext statt als PDF/XML-Anhang. Wird per
  // Headless-Chrome zu einem PDF gerendert und läuft danach wie jeder andere
  // Anhang durch dieselbe Erkennung/Klassifikation (siehe lib/htmlToPdf.ts).
  htmlBody?: string | null,
  textBody?: string | null,
): Promise<{ processed: number; ok: boolean; docIds: string[] }> {
  const s = await getSettings()

  // Absender-Beschränkung: erst global, dann je Mandant
  if (!domainAllowed(from, s.MAIL_IN_ALLOWED_DOMAINS) || !domainAllowed(from, tenant.mailAllowedDomains)) {
    await prisma.mailIntake.create({
      data: {
        tenantId: tenant.id,
        fromAddress: from,
        toAddress,
        subject,
        status: 'SENDER_REJECTED',
        detail: `Absender-Domäne ${domainOf(from)} nicht zugelassen`,
        sourceMessageId,
      },
    })
    return { processed: 0, ok: false, docIds: [] }
  }

  // Verwertbare Anhänge: per MIME-Typ ODER Datei-Endung (manche Mailprogramme
  // deklarieren z. B. XML-Anhänge als application/octet-stream)
  const EXT_MIME: Record<string, string> = {
    pdf: 'application/pdf',
    xml: 'application/xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  }
  let usable = attachments
    .map((a) => {
      const ext = (a.filename ?? '').split('.').pop()?.toLowerCase() ?? ''
      const mime = ALLOWED_MIME.includes(a.contentType) ? a.contentType : EXT_MIME[ext]
      return mime ? { att: a, mime } : null
    })
    .filter((x): x is { att: InboundAttachment; mime: string } => Boolean(x && x.att.content.length <= MAX_FILE_BYTES))

  // Mailtext (Stefan 2026-08-25): unabhängig vom Anhang aufgehoben und am
  // Beleg gespeichert — kann relevante Zusatzinformationen enthalten, die
  // nicht auf dem Beleg selbst stehen (z. B. "diese Rechnung ersetzt die
  // vorherige"). Länge gedeckelt, damit kein Newsletter-Wildwuchs die Notiz sprengt.
  const mailBodyText = (textBody?.trim() || (htmlBody ? htmlToPlainText(htmlBody) : '') || null)?.slice(0, 5000) || null

  // HTML-Rechnung ohne Anhang (Stefan 2026-08-25, Ausland/Drittland): den
  // Mailtext selbst als Beleg behandeln, statt die Mail zu verwerfen — läuft
  // ab hier wie jeder andere Anhang durch dieselbe Erkennung/Klassifikation.
  // htmlRendered kennzeichnet den entstehenden Beleg als NICHT vom
  // Lieferanten mitgeschicktes Original-PDF, sondern serverseitig gerendert
  // (Anzeige in der "Inhalt"-Spalte, InvoiceRows.tsx).
  let bodyRenderFailed = false
  let htmlRendered = false
  if (usable.length === 0 && (htmlBody || textBody)) {
    const body = htmlBody || `<pre style="white-space:pre-wrap;font-family:sans-serif">${
      (textBody ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }</pre>`
    // Archivierungs-Hinweis FEST im PDF selbst (Stefan 2026-08-25), nicht nur
    // als UI-Label — der Hinweis muss auch erhalten bleiben, wenn die PDF
    // separat heruntergeladen/weitergegeben wird (GoBD-Nachvollziehbarkeit:
    // klar erkennbar, dass es sich um eine Rekonstruktion handelt, kein
    // Original-Dokument des Lieferanten). Vor "</body>" eingefügt statt
    // einfach angehängt — echte HTML-Mails haben meist schon ein
    // vollständiges <html><body>…</body></html>-Gerüst, Inhalt NACH
    // "</html>" würde vom Parser nicht zuverlässig gerendert.
    const disclaimer =
      `<hr style="margin-top:28px;border:none;border-top:1px solid #ccc;" />` +
      `<p style="margin-top:10px;color:#888;font-size:10px;font-family:sans-serif;">` +
      `Hinweis: Diese Rechnung ist per E-Mail in Textform (HTML) ohne Datei-Anhang eingegangen und wurde am ` +
      `${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} zur besseren Archivierung automatisch ` +
      `in das PDF-Format überführt. Es handelt sich um eine Rekonstruktion, nicht um ein Original-Dokument.</p>`
    const html = /<\/body>/i.test(body) ? body.replace(/<\/body>/i, `${disclaimer}</body>`) : `${body}${disclaimer}`
    const pdf = await renderHtmlToPdf(html)
    if (pdf && pdf.length <= MAX_FILE_BYTES) {
      usable = [{ att: { filename: 'email.pdf', contentType: 'application/pdf', content: pdf }, mime: 'application/pdf' }]
      htmlRendered = true
    } else {
      bodyRenderFailed = true
    }
  }

  if (usable.length === 0) {
    await prisma.mailIntake.create({
      data: {
        tenantId: tenant.id,
        fromAddress: from,
        toAddress,
        subject,
        status: 'NO_ATTACHMENT',
        detail: bodyRenderFailed ? 'Mailtext konnte nicht als Beleg gerendert werden' : 'Kein PDF-/Bild-Anhang gefunden',
        sourceMessageId,
      },
    })
    return { processed: 0, ok: false, docIds: [] }
  }

  const { inboxId, quarantineId } = await ensureSystemBaskets(tenant.id)
  const canUseAi = tenant.aiAllowed && hasFeature(tenant, 'AI') && (await isAiConfigured())
  let processed = 0
  const docIds: string[] = []
  for (const { att, mime } of usable) {
    const buffer = Buffer.from(att.content)
    // E-Rechnung (W17): Format erkennen, Daten übernehmen, Pflichtfelder prüfen
    const analysis = await analyzeInvoiceFile(buffer, mime, att.filename ?? '')
    const d = analysis.data

    // Spam-/Nicht-Rechnung-Klassifikation (Stefan 2026-08-25, "3-Stufen"):
    // eine strukturierte, gültige E-Rechnung ist per Format-Validierung
    // schon vertrauenswürdig — kein weiterer Check nötig. Für "nackte"
    // PDFs/Bilder (inkl. der aus HTML gerenderten) läuft dieselbe KI-
    // Erkennung wie bisher, jetzt zusätzlich mit Dokumenttyp-Einschätzung
    // (kein zweiter API-Call). Ohne KI-Anbieter: vorsichtige Stichwort-
    // Heuristik, die NIE "NOT_INVOICE" liefert (siehe classifyByKeywords
    // oben) — Spam-Erkennung ist dann effektiv aus, aber es geht auch nichts
    // fälschlich in den Spam-Verdacht-Korb.
    const isStructuredValid =
      (analysis.format === 'ZUGFERD' || analysis.format?.startsWith('XRECHNUNG')) && analysis.validation?.valid === true
    let invoiceClass: 'INVOICE' | 'UNCERTAIN' | 'NOT_INVOICE' = 'INVOICE'
    let ai: AiExtractedInvoice | null = null
    if (!isStructuredValid) {
      if (mime === 'application/pdf' && analysis.format === 'PDF' && canUseAi) {
        try {
          const png = await rasterizeFirstPage(buffer)
          if (png) {
            ai = await extractInvoiceFromImage(png.toString('base64'), 'image/png')
            invoiceClass = ai.documentType === 'not_invoice' ? 'NOT_INVOICE' : ai.documentType === 'invoice' ? 'INVOICE' : 'UNCERTAIN'
          } else {
            invoiceClass = 'UNCERTAIN'
          }
        } catch (e) {
          // Kein harter Fehler für die ganze Mail — Rechnung bleibt als "nur
          // PDF" ohne erkannte Daten bestehen, Nutzer kann "Mit KI erkennen"
          // jederzeit manuell auf der Detailseite nachholen.
          console.error('Automatische KI-Erkennung beim Mail-Eingang fehlgeschlagen:', e instanceof Error ? e.message : e)
          invoiceClass = 'UNCERTAIN'
        }
      } else if (mime === 'application/pdf' && analysis.format === 'PDF') {
        const text = await extractFirstPageText(buffer)
        invoiceClass = text ? classifyByKeywords(text) : 'UNCERTAIN'
      } else {
        // Bild-Anhang ohne KI-Lauf (Foto/Scan als Mail-Anhang, kein Textlayer) —
        // keine Aussage möglich, sicherheitshalber "unsicher" statt zu raten.
        invoiceClass = 'UNCERTAIN'
      }
    }

    const fileHash = hashBuffer(buffer)
    const duplicateOfId = await detectDuplicate(tenant.id, {
      fileHash,
      invoiceNumber: d?.number ?? null,
      vendor: d?.sellerName ?? null,
    })
    const fileName = await saveInvoiceFile(tenant.id, att.filename ?? 'beleg.pdf', buffer)
    const docId = await nextDocId(tenant.id)
    const electronicCheck = autoElectronicCheck(analysis.format, analysis.validation?.valid)
    const basketId = invoiceClass === 'NOT_INVOICE' ? quarantineId : inboxId
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: tenant.id,
        docId,
        basketId,
        checkElectronicAt: electronicCheck.at,
        checkElectronicBy: electronicCheck.by,
        vendor: ai?.vendor || d?.sellerName || domainOf(from) || from,
        invoiceNumber: ai?.invoiceNumber ?? d?.number ?? null,
        invoiceDate: ai?.invoiceDate ? new Date(ai.invoiceDate) : d?.issueDate ? new Date(d.issueDate) : null,
        dueDate: ai?.dueDate ? new Date(ai.dueDate) : d?.dueDate ? new Date(d.dueDate) : null,
        discountDueDate: ai?.discountDueDate
          ? new Date(ai.discountDueDate)
          : d?.discountDueDate
            ? new Date(d.discountDueDate)
            : null,
        discountPercent: ai?.discountPercent ?? d?.discountPercent ?? null,
        amountNet: ai?.amountNet ?? d?.net ?? null,
        amountTax: ai?.amountTax ?? d?.tax ?? null,
        amountGross: ai?.amountGross ?? d?.gross ?? null,
        currency: ai?.currency || d?.currency || 'EUR',
        tags: ai?.tags ?? null,
        directDebitByVendor: ai?.directDebitByVendor ?? false,
        lineItems: ai?.lines && ai.lines.length > 0 ? ai.lines : undefined,
        status: InvoiceStatus.NEW,
        // Datum/Uhrzeit im Notiztext (Stefan 2026-08-25): vorher stand hier
        // nur Betreff/Absender ohne Zeitangabe — createdAt trägt zwar den
        // Zeitstempel, ist aber in der Notiz selbst nicht sichtbar, wenn man
        // nur den Text liest/kopiert.
        notes: `E-Mail-Eingang (${via}) am ${new Date().toLocaleString('de-DE')}: ${subject || '(ohne Betreff)'} · von ${from}`,
        fileName,
        originalName: att.filename ?? 'beleg.pdf',
        mimeType: mime,
        source: 'EMAIL',
        fileHash,
        duplicateOfId,
        docFormat: analysis.format,
        xmlData: analysis.xml,
        validationOk: analysis.validation?.valid ?? null,
        validationIssues: analysis.validation?.missing.join(', ') || null,
        invoiceClass,
        htmlRendered,
        mailBodyText,
        // KI-Werte sind NICHT sofort vertrauenswürdig: aiAssisted=true macht
        // die Rechnung erst nach menschlicher Bestätigung verschiebbar (siehe
        // lib/baskets.ts requestMove) und markiert sie in der Liste
        // andersfarbig, bis das passiert ist (InvoiceEditForm.tsx
        // Tab-Bestätigungs-Flow) — gilt auch für Belege im Spam-Verdacht-Korb,
        // damit ein Zurückholen dieselbe Prüfung durchläuft wie eine normale
        // KI-Erkennung.
        aiAssisted: ai !== null,
        aiUncertainFields: ai && ai.uncertainFields.length > 0 ? ai.uncertainFields.join(',') : null,
      },
    })

    await prisma.mailIntake.create({
      data: {
        tenantId: tenant.id,
        fromAddress: from,
        toAddress,
        subject,
        status: 'PROCESSED',
        detail: `${att.filename ?? 'Anhang'} (${analysis.format})${duplicateOfId ? ' · DUBLETTE' : ''}${invoiceClass !== 'INVOICE' ? ` · ${invoiceClass}` : ''}`,
        invoiceId: invoice.id,
        sourceMessageId,
      },
    })

    if (invoiceClass === 'NOT_INVOICE' && tenant.spamReplyEnabled) {
      await sendSpamNotice(tenant, from, subject, invoice.id)
    }

    if (docId) docIds.push(docId)
    processed++
  }
  await audit({
    tenantId: tenant.id,
    actorName: `E-Mail-Eingang (${via})`,
    action: 'INVOICE_CREATE',
    details: `${processed} Beleg(e) aus E-Mail von ${from}`,
  })
  return { processed, ok: true, docIds }
}

/**
 * Verarbeitet eine geparste Mail: Mandanten-Auflösung über Empfängeradresse,
 * Absender-Prüfung, Beleg-Anlage, Protokollierung. `rcpts` sind die
 * Empfängeradressen (bei SMTP: Envelope RCPT TO — zuverlässiger als Header).
 */
export async function handleParsedMail(
  parsed: ParsedMail,
  rcpts: string[],
  via: 'SMTP' = 'SMTP',
): Promise<{ processed: number; ok: boolean }> {
  const s = await getSettings()
  const domain = (s.MAIL_IN_DOMAIN || '').toLowerCase()
  const from = parsed.from?.value[0]?.address?.toLowerCase() ?? 'unbekannt'
  const subject = (parsed.subject ?? '').slice(0, 200)
  const allRcpts = rcpts.length > 0 ? rcpts : [...addressList(parsed.to), ...addressList(parsed.cc)]

  // Empfänger → Mandanten-Slug: beliebig@<kurzname>.<basis-domain>
  // Die Basis-Domain ist vom Betreiber parametrisierbar (SP01), der lokale Teil ist egal.
  const pattern = new RegExp(`^[^@\\s]+@([a-z0-9-]+)\\.${domain.replace(/\./g, '\\.')}$`)
  const match = allRcpts
    .map((r) => {
      const m = r.toLowerCase().match(pattern)
      return m ? { to: r.toLowerCase(), slug: m[1] } : null
    })
    .find(Boolean)

  if (!match) {
    await prisma.mailIntake.create({
      data: {
        fromAddress: from,
        toAddress: allRcpts[0] ?? '—',
        subject,
        status: 'UNKNOWN_RECIPIENT',
        detail: `[${via}] Keine Einlieferungs-Adresse eines Mandanten`,
      },
    })
    return { processed: 0, ok: false }
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: match.slug } })
  if (!tenant || !tenant.active) {
    await prisma.mailIntake.create({
      data: {
        tenantId: tenant?.id ?? null,
        fromAddress: from,
        toAddress: match.to,
        subject,
        status: tenant ? 'TENANT_LOCKED' : 'UNKNOWN_RECIPIENT',
        detail: tenant ? 'Mandant ist gesperrt' : `Kein Mandant mit Kurzname "${match.slug}"`,
      },
    })
    return { processed: 0, ok: false }
  }

  return processInboundAttachments(
    tenant,
    from,
    match.to,
    subject,
    parsed.attachments ?? [],
    via,
    undefined,
    typeof parsed.html === 'string' ? parsed.html : null,
    parsed.text ?? null,
  )
}
