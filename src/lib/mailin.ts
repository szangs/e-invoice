// E-Mail-Eingang (Weiterleitungs-Modell W1/W2): holt Mails aus dem zentralen
// Einlieferungs-Postfach, ordnet sie über rechnung-<kurzname>@<domain> dem Mandanten
// zu, legt Belege an und protokolliert JEDEN Eingang/Versuch in MailIntake.
// Hinweis: E-Mail-Eingang ist prinzipbedingt nicht Ende-zu-Ende-verschlüsselbar.
import { InvoiceStatus } from '@prisma/client'
import { ImapFlow } from 'imapflow'
import { simpleParser, type AddressObject } from 'mailparser'
import { audit } from '@/lib/audit'
import { prisma } from '@/lib/db'
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

export async function pollMailbox(): Promise<PollResult> {
  const s = await getSettings()
  if (s.MAIL_IN_ENABLED !== '1') {
    return { ok: false, message: 'E-Mail-Eingang ist deaktiviert (Systemeinstellungen → Mail-Eingang).' }
  }
  if (!s.MAIL_IN_HOST || !s.MAIL_IN_USER || !s.MAIL_IN_DOMAIN) {
    return { ok: false, message: 'Mail-Eingang unvollständig konfiguriert (Host, Benutzer, Domain).' }
  }
  const prefix = (s.MAIL_IN_PREFIX || 'rechnung-').toLowerCase()
  const domain = s.MAIL_IN_DOMAIN.toLowerCase()

  const client = new ImapFlow({
    host: s.MAIL_IN_HOST,
    port: Number(s.MAIL_IN_PORT || 993),
    secure: s.MAIL_IN_SECURE !== '', // Standard: TLS an
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
      const uids = (unseen || []).slice(0, 25) // pro Abruf begrenzen
      for (const uid of uids) {
        fetched++
        try {
          const msg = await client.fetchOne(String(uid), { source: true })
          if (!msg || !msg.source) continue
          const parsed = await simpleParser(msg.source)
          const from = parsed.from?.value[0]?.address?.toLowerCase() ?? 'unbekannt'
          const recipients = [...addressList(parsed.to), ...addressList(parsed.cc)]
          const subject = (parsed.subject ?? '').slice(0, 200)

          // Empfänger → Mandanten-Slug auflösen
          const match = recipients
            .map((r) => {
              const m = r.match(new RegExp(`^${prefix}([a-z0-9-]+)@${domain.replace('.', '\\.')}$`))
              return m ? { to: r, slug: m[1] } : null
            })
            .find(Boolean)

          if (!match) {
            rejected++
            await prisma.mailIntake.create({
              data: {
                fromAddress: from,
                toAddress: recipients[0] ?? '—',
                subject,
                status: 'UNKNOWN_RECIPIENT',
                detail: 'Keine Einlieferungs-Adresse eines Mandanten',
              },
            })
            await client.messageFlagsAdd(String(uid), ['\\Seen'])
            continue
          }

          const tenant = await prisma.tenant.findUnique({ where: { slug: match.slug } })
          if (!tenant || !tenant.active) {
            rejected++
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
            await client.messageFlagsAdd(String(uid), ['\\Seen'])
            continue
          }

          // Verwertbare Anhänge (PDF/Bild) → Belege anlegen
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
            await client.messageFlagsAdd(String(uid), ['\\Seen'])
            continue
          }

          for (const att of usable) {
            const fileName = await saveInvoiceFile(
              tenant.id,
              att.filename ?? 'beleg.pdf',
              Buffer.from(att.content),
            )
            const invoice = await prisma.invoice.create({
              data: {
                tenantId: tenant.id,
                vendor: from.split('@')[1] ?? from,
                status: InvoiceStatus.NEW,
                notes: `E-Mail-Eingang: ${subject || '(ohne Betreff)'} · von ${from}`,
                fileName,
                originalName: att.filename ?? 'beleg.pdf',
                mimeType: att.contentType,
                source: 'EMAIL',
              },
            })
            await prisma.mailIntake.create({
              data: {
                tenantId: tenant.id,
                fromAddress: from,
                toAddress: match.to,
                subject,
                status: 'PROCESSED',
                detail: att.filename ?? undefined,
                invoiceId: invoice.id,
              },
            })
            processed++
          }
          await audit({
            tenantId: tenant.id,
            actorName: 'E-Mail-Eingang',
            action: 'INVOICE_CREATE',
            details: `${usable.length} Beleg(e) aus E-Mail von ${from}`,
          })
          await client.messageFlagsAdd(String(uid), ['\\Seen'])
        } catch (e) {
          await prisma.mailIntake.create({
            data: {
              fromAddress: '—',
              toAddress: '—',
              status: 'ERROR',
              detail: e instanceof Error ? e.message.slice(0, 300) : 'Unbekannter Fehler',
            },
          })
          await client.messageFlagsAdd(String(uid), ['\\Seen']).catch(() => undefined)
        }
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
