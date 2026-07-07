// E-Mail-Eingang (Weiterleitungs-Modell W1/W2) — gemeinsame Verarbeitung für BEIDE Wege:
// (A) IMAP-Abruf eines bestimmten Postfachs (pollMailbox)
// (B) eigener SMTP-Empfänger auf der Subdomain (scripts/smtp-server.ts, Catch-All)
// Absender-Beschränkung: global (MAIL_IN_ALLOWED_DOMAINS) und je Mandant (mailAllowedDomains).
// Hinweis: E-Mail-Eingang ist prinzipbedingt nicht Ende-zu-Ende-verschlüsselbar.
import { InvoiceStatus } from '@prisma/client'
import { ImapFlow } from 'imapflow'
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser'
import { audit } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { analyzeInvoiceFile } from '@/lib/erechnung'
import { getSettings } from '@/lib/settings'
import { ALLOWED_MIME, MAX_FILE_BYTES, saveInvoiceFile } from '@/lib/storage'

export type PollResult = {
  ok: boolean
  message: string
  fetched?: number
  processed?: number
  rejected?: number
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

/**
 * Verarbeitet eine geparste Mail: Mandanten-Auflösung über Empfängeradresse,
 * Absender-Prüfung, Beleg-Anlage, Protokollierung. `rcpts` sind die
 * Empfängeradressen (bei SMTP: Envelope RCPT TO — zuverlässiger als Header).
 */
export async function handleParsedMail(
  parsed: ParsedMail,
  rcpts: string[],
  via: 'IMAP' | 'SMTP',
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

  const usable = (parsed.attachments ?? []).filter(
    (a) => ALLOWED_MIME.includes(a.contentType) && a.content.length <= MAX_FILE_BYTES,
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

  let processed = 0
  for (const att of usable) {
    const buffer = Buffer.from(att.content)
    // E-Rechnung (W17): Format erkennen, Daten übernehmen, Pflichtfelder prüfen
    const analysis = await analyzeInvoiceFile(buffer, att.contentType, att.filename ?? '')
    const d = analysis.data
    const fileName = await saveInvoiceFile(tenant.id, att.filename ?? 'beleg.pdf', buffer)
    const invoice = await prisma.invoice.create({
      data: {
        tenantId: tenant.id,
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
        mimeType: att.contentType,
        source: 'EMAIL',
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
        detail: `${att.filename ?? 'Anhang'} (${analysis.format})`,
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

/** Weg A: IMAP-Abruf eines bestimmten Postfachs (auch Catch-All-Postfach möglich). */
export async function pollMailbox(): Promise<PollResult> {
  const s = await getSettings()
  if (s.MAIL_IN_ENABLED !== '1') {
    return { ok: false, message: 'E-Mail-Eingang ist deaktiviert (Systemeinstellungen → Mail-Eingang).' }
  }
  if (!s.MAIL_IN_HOST || !s.MAIL_IN_USER || !s.MAIL_IN_DOMAIN) {
    return { ok: false, message: 'Mail-Eingang unvollständig konfiguriert (Host, Benutzer, Domain).' }
  }

  const client = new ImapFlow({
    host: s.MAIL_IN_HOST,
    port: Number(s.MAIL_IN_PORT || 993),
    secure: s.MAIL_IN_SECURE !== '',
    auth: { user: s.MAIL_IN_USER, pass: s.MAIL_IN_PASS },
    logger: false,
  })

  let fetched = 0
  let processed = 0
  let rejected = 0
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      const unseen = await client.search({ seen: false })
      const uids = (unseen || []).slice(0, 25)
      for (const uid of uids) {
        fetched++
        try {
          const msg = await client.fetchOne(String(uid), { source: true })
          if (!msg || !msg.source) continue
          const parsed = await simpleParser(msg.source)
          const result = await handleParsedMail(parsed, [], 'IMAP')
          if (result.ok) processed += result.processed
          else rejected++
        } catch (e) {
          rejected++
          await prisma.mailIntake.create({
            data: {
              fromAddress: '—',
              toAddress: '—',
              status: 'ERROR',
              detail: e instanceof Error ? e.message.slice(0, 300) : 'Unbekannter Fehler',
            },
          })
        }
        await client.messageFlagsAdd(String(uid), ['\\Seen']).catch(() => undefined)
      }
    } finally {
      lock.release()
    }
    await client.logout()
    return {
      ok: true,
      message: `Abruf fertig: ${fetched} neu, ${processed} Beleg(e) angelegt, ${rejected} abgewiesen.`,
      fetched,
      processed,
      rejected,
    }
  } catch (e) {
    await client.logout().catch(() => undefined)
    return {
      ok: false,
      message: `Postfach nicht erreichbar: ${e instanceof Error ? e.message : 'Fehler'}`,
    }
  }
}
