// E-Mail-Eingang per IMAP (Stefan 2026-08-27, Review-Fund "unter Mail noch
// eine Unterkategorie zur Auswahl des Email-Verfahrens — jetzt fehlt noch
// POP und IMAP"): vierte Alternative, Postfach + Ordner werden per IMAPS
// abgefragt (nur implizites TLS, Standardport 993). Anders als POP3 werden
// Nachrichten NICHT gelöscht: nach Verarbeitung wird \Seen gesetzt (SEARCH
// UNSEEN beim nächsten Poll findet sie dann nicht erneut) und optional in
// einen Zielordner verschoben — dieselbe Semantik wie beim Graph-Weg (siehe
// graphMailin.ts). Dublettenprüfung zusätzlich über die Message-ID
// (MailIntake.sourceMessageId) als Sicherheitsnetz, falls das \Seen-Setzen
// selbst fehlschlägt oder ein anderes Mail-Programm dieselbe Nachricht
// parallel liest/markiert.
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { type Tenant } from '@prisma/client'
import { prisma } from '@/lib/db'
import { type InboundAttachment, processInboundAttachments } from '@/lib/mailin'
import { friendlyMailinAuthError } from '@/lib/mailinAuthError'
import { isMailinDue, markMailinPolled } from '@/lib/mailinSchedule'
import { getSettings } from '@/lib/settings'

type ImapCreds = Pick<Tenant, 'mailInImapHost' | 'mailInImapPort' | 'mailInImapSecure' | 'mailInImapUser' | 'mailInImapPass'>

type ImapTenantFields = Pick<
  Tenant,
  | 'id'
  | 'name'
  | 'mailAllowedDomains'
  | 'aiAllowed'
  | 'licensePlan'
  | 'licenseExpiresAt'
  | 'spamReplyEnabled'
  | 'autoDeleteExactDuplicates'
  | 'autoSupersedeInvoiceVersions'
  | 'mailInImapFolder'
  | 'mailInImapMoveToFolder'
  | 'mailInPollSeconds'
  | 'mailInLastPolledAt'
> &
  ImapCreds

function buildClient(tenant: ImapCreds): ImapFlow {
  return new ImapFlow({
    host: tenant.mailInImapHost!,
    port: tenant.mailInImapPort,
    secure: tenant.mailInImapSecure,
    auth: { user: tenant.mailInImapUser ?? '', pass: tenant.mailInImapPass ?? '' },
    logger: false,
  })
}

/** Für den "Verbindung testen"-Knopf (Mandanten-Einstellungen): meldet sich an, öffnet den Ordner, zählt Nachrichten. */
export async function testImapMailbox(tenant: ImapCreds, folderPath: string | null | undefined): Promise<{ messageCount: number }> {
  if (!tenant.mailInImapHost) throw new Error('Kein Server eingetragen')
  const client = buildClient(tenant)
  await client.connect()
  try {
    const lock = await client.getMailboxLock(folderPath || 'INBOX')
    try {
      return { messageCount: client.mailbox ? client.mailbox.exists : 0 }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => undefined)
  }
}

/**
 * Fragt für alle dafür aktivierten Mandanten ihr konfiguriertes IMAP-Postfach/
 * Ordner ab — mit `tenantId` auf genau einen Mandanten eingeschränkt (manueller
 * "Jetzt abrufen"-Knopf, siehe api/mailin/poll/route.ts). `respectSchedule`
 * (Stefan 2026-08-27, eigenes Poll-Intervall je Mandant, siehe
 * lib/mailinSchedule.ts): beim automatischen Poller (Standard) übersprungen,
 * solange das eigene Intervall des Mandanten noch nicht abgelaufen ist — der
 * manuelle "Jetzt abrufen"-Knopf setzt `false` und ignoriert das bewusst.
 */
export async function runImapMailinPoll(tenantId?: string, respectSchedule = true): Promise<string[]> {
  const log: string[] = []
  const s = await getSettings()
  if (s.MAIL_IN_IMAP_ENABLED !== '1') return ['IMAP-Mail-Eingang ist deaktiviert (Systemeinstellungen).']

  const allTenants: ImapTenantFields[] = await prisma.tenant.findMany({
    where: { active: true, mailInImapEnabled: true, mailInImapHost: { not: null }, ...(tenantId ? { id: tenantId } : {}) },
  })
  if (allTenants.length === 0) return ['Kein Mandant hat den IMAP-Mail-Eingang aktiviert.']
  const globalDefault = Number(s.MAIL_IN_IMAP_POLL_SECONDS) || 180
  const tenants = respectSchedule ? allTenants.filter((t) => isMailinDue(t, globalDefault)) : allTenants
  if (tenants.length === 0) return []

  for (const tenant of tenants) {
    await markMailinPolled(tenant.id)
    const client = buildClient(tenant)
    const folder = tenant.mailInImapFolder || 'INBOX'
    let processed = 0
    try {
      await client.connect()
      const lock = await client.getMailboxLock(folder)
      try {
        const uids = ((await client.search({ seen: false }, { uid: true })) || []) as number[]
        for (const uid of uids) {
          try {
            const msg = await client.fetchOne(uid, { source: true }, { uid: true })
            if (!msg || !msg.source) continue
            const parsed = await simpleParser(msg.source)
            const messageId = parsed.messageId || undefined
            let already = false
            if (messageId) {
              already = Boolean(
                await prisma.mailIntake.findFirst({ where: { tenantId: tenant.id, sourceMessageId: messageId }, select: { id: true } }),
              )
            }
            if (!already) {
              const from = parsed.from?.value[0]?.address?.toLowerCase() ?? 'unbekannt'
              const subject = (parsed.subject ?? '').slice(0, 200)
              const attachments: InboundAttachment[] = (parsed.attachments ?? []).map((a) => ({
                filename: a.filename,
                contentType: a.contentType,
                content: a.content,
              }))
              const result = await processInboundAttachments(
                tenant,
                from,
                tenant.mailInImapUser ?? tenant.mailInImapHost!,
                subject,
                attachments,
                'IMAP',
                messageId,
                typeof parsed.html === 'string' ? parsed.html : null,
                parsed.text ?? null,
              )
              processed += result.processed
            }
            // Erst NACH Verarbeitung als gelesen markieren, damit ein Fehler oben
            // (catch unten) die Nachricht beim nächsten Poll erneut versuchen lässt.
            await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
            if (tenant.mailInImapMoveToFolder) {
              try {
                await client.messageMove(uid, tenant.mailInImapMoveToFolder, { uid: true })
              } catch (e) {
                const detail = e instanceof Error ? e.message : String(e)
                log.push(`${tenant.name}: Verschieben von Nachricht ${uid} fehlgeschlagen — ${detail}`)
              }
            }
          } catch (e) {
            const detail = e instanceof Error ? e.message : String(e)
            log.push(`${tenant.name}: Nachricht ${uid} übersprungen — ${detail}`)
          }
        }
      } finally {
        lock.release()
      }
      log.push(`${tenant.name}: ${processed} Beleg(e) von ${tenant.mailInImapHost}/${folder}.`)
    } catch (e) {
      const detail = friendlyMailinAuthError(e)
      log.push(`${tenant.name}: Fehler beim Abruf von ${tenant.mailInImapHost} — ${detail}`)
    } finally {
      await client.logout().catch(() => undefined)
    }
  }
  return log
}
