// E-Mail-Eingang (Weiterleitungs-Modell W1/W2): eigener SMTP-Empfänger auf
// der Subdomain (scripts/smtp-server.ts, Catch-All) — IMAP-Postfachabruf
// wurde am 2026-07-08 auf Stefans Wunsch entfernt (nur noch der Weg über den
// eigenen SMTP-Empfänger). Absender-Beschränkung: global
// (MAIL_IN_ALLOWED_DOMAINS) und je Mandant (mailAllowedDomains). Hinweis:
// E-Mail-Eingang ist prinzipbedingt nicht Ende-zu-Ende-verschlüsselbar.
import { InvoiceStatus } from '@prisma/client'
import { type AddressObject, type ParsedMail } from 'mailparser'
import { audit } from '@/lib/audit'
import { getInboxBasketId } from '@/lib/baskets'
import { prisma } from '@/lib/db'
import { nextDocId } from '@/lib/docId'
import { detectDuplicate, hashBuffer } from '@/lib/duplicates'
import { analyzeInvoiceFile } from '@/lib/erechnung'
import { getSettings } from '@/lib/settings'
import { ALLOWED_MIME, MAX_FILE_BYTES, saveInvoiceFile } from '@/lib/storage'

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

  // Absender-Beschränkung: erst global, dann je Mandant
  if (!domainAllowed(from, s.MAIL_IN_ALLOWED_DOMAINS) || !domainAllowed(from, tenant.mailAllowedDomains)) {
    await prisma.mailIntake.create({
      data: {
        tenantId: tenant.id,
        fromAddress: from,
        toAddress: match.to,
        subject,
        status: 'SENDER_REJECTED',
        detail: `Absender-Domäne ${domainOf(from)} nicht zugelassen`,
      },
    })
    return { processed: 0, ok: false }
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
  const usable = (parsed.attachments ?? [])
    .map((a) => {
      const ext = (a.filename ?? '').split('.').pop()?.toLowerCase() ?? ''
      const mime = ALLOWED_MIME.includes(a.contentType) ? a.contentType : EXT_MIME[ext]
      return mime ? { att: a, mime } : null
    })
    .filter((x): x is { att: NonNullable<ParsedMail['attachments']>[number]; mime: string } =>
      Boolean(x && x.att.content.length <= MAX_FILE_BYTES),
    )
  if (usable.length === 0) {
    await prisma.mailIntake.create({
      data: {
        tenantId: tenant.id,
        fromAddress: from,
        toAddress: match.to,
        subject,
        status: 'NO_ATTACHMENT',
        detail: 'Kein PDF-/Bild-Anhang gefunden',
      },
    })
    return { processed: 0, ok: false }
  }

  const basketId = await getInboxBasketId(tenant.id)
  let processed = 0
  for (const { att, mime } of usable) {
    const buffer = Buffer.from(att.content)
    // E-Rechnung (W17): Format erkennen, Daten übernehmen, Pflichtfelder prüfen
    const analysis = await analyzeInvoiceFile(buffer, mime, att.filename ?? '')
    const d = analysis.data
    const fileHash = hashBuffer(buffer)
    const duplicateOfId = await detectDuplicate(tenant.id, {
      fileHash,
      invoiceNumber: d?.number ?? null,
      vendor: d?.sellerName ?? null,
    })
    const fileName = await saveInvoiceFile(tenant.id, att.filename ?? 'beleg.pdf', buffer)
    const docId = await nextDocId(tenant.id)
    const autoElectronicOk = analysis.validation?.valid === true
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: tenant.id,
        docId,
        basketId,
        checkElectronicAt: autoElectronicOk ? new Date() : null,
        checkElectronicBy: autoElectronicOk ? 'System (automatische Prüfung)' : null,
        vendor: d?.sellerName || domainOf(from) || from,
        invoiceNumber: d?.number ?? null,
        invoiceDate: d?.issueDate ? new Date(d.issueDate) : null,
        dueDate: d?.dueDate ? new Date(d.dueDate) : null,
        amountNet: d?.net ?? null,
        amountTax: d?.tax ?? null,
        amountGross: d?.gross ?? null,
        currency: d?.currency ?? 'EUR',
        status: InvoiceStatus.NEW,
        notes: `E-Mail-Eingang (${via}): ${subject || '(ohne Betreff)'} · von ${from}`,
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
      },
    })
    await prisma.mailIntake.create({
      data: {
        tenantId: tenant.id,
        fromAddress: from,
        toAddress: match.to,
        subject,
        status: 'PROCESSED',
        detail: `${att.filename ?? 'Anhang'} (${analysis.format})${duplicateOfId ? ' · DUBLETTE' : ''}`,
        invoiceId: invoice.id,
      },
    })
    processed++
  }
  await audit({
    tenantId: tenant.id,
    actorName: `E-Mail-Eingang (${via})`,
    action: 'INVOICE_CREATE',
    details: `${processed} Beleg(e) aus E-Mail von ${from}`,
  })
  return { processed, ok: true }
}
