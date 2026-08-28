// E-Mail-Eingang per POP3 (Stefan 2026-08-27, Review-Fund "unter Mail noch
// eine Unterkategorie zur Auswahl des Email-Verfahrens — jetzt fehlt noch
// POP und IMAP"): dritte Alternative neben Weiterleitung und Microsoft
// Graph, klassischer Postfach-Abruf per POP3S (nur implizites TLS, Port 995
// — kein STARTTLS auf Port 110, siehe Tenant.mailInPop3Secure in schema.prisma).
// POP3 kennt keine Ordner/Markierungen wie IMAP — abgerufene Nachrichten
// werden nach erfolgreicher Verarbeitung per DELE vom Server gelöscht,
// dadurch bleibt das Postfach von selbst auf "nur Neues" begrenzt (kein
// Fortschritts-Zeiger nötig, anders als beim Graph-Weg, siehe
// graphMailin.ts). Als zusätzliches Sicherheitsnetz läuft trotzdem dieselbe
// Message-ID-Dublettenprüfung wie bei Graph/IMAP mit — falls das Löschen
// nach erfolgreicher Verarbeitung selbst fehlschlägt (Verbindungsabbruch
// zwischen RETR und DELE), verhindert sie eine doppelte Rechnung beim
// nächsten Poll, statt die Nachricht einfach noch einmal zu verarbeiten.
import type Pop3CommandType from 'node-pop3'
import { simpleParser } from 'mailparser'
import { type Tenant } from '@prisma/client'
import { prisma } from '@/lib/db'
import { type InboundAttachment, processInboundAttachments } from '@/lib/mailin'
import { friendlyMailinAuthError } from '@/lib/mailinAuthError'
import { isMailinDue, markMailinPolled } from '@/lib/mailinSchedule'
import { getSettings } from '@/lib/settings'

type Pop3TenantFields = Pick<
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
  | 'mailInPop3Host'
  | 'mailInPop3Port'
  | 'mailInPop3Secure'
  | 'mailInPop3User'
  | 'mailInPop3Pass'
  | 'mailInPollSeconds'
  | 'mailInLastPolledAt'
>

// Dynamischer statt statischer Import (Stefan 2026-08-27): node-pop3@0.15.0
// liefert ein fehlerhaftes CJS-Build (lib/Command.cjs enthält noch
// unübersetzte "import"-Syntax) — ein normaler `import Pop3Command from
// 'node-pop3'` bricht beim Ausführen über den eigenständigen Poller-Prozess
// (tsx/Node im CJS-Modus, siehe scripts/pop3-mailin-poller.ts) mit
// "does not provide an export named 'listify'". Node löst die "exports"-
// Bedingungen eines Pakets bei `import()` IMMER über die "import"-Variante
// auf (unabhängig vom Modultyp des aufrufenden Codes) — das trifft bei
// node-pop3 auf die intakte ESM-Quelle statt des kaputten CJS-Builds und
// funktioniert dadurch überall gleich (Next.js-Bundler wie eigenständiger
// Prozess).
async function loadPop3Command(): Promise<typeof Pop3CommandType> {
  const mod = await import('node-pop3')
  return mod.default
}

async function buildClient(
  tenant: Pick<Tenant, 'mailInPop3Host' | 'mailInPop3Port' | 'mailInPop3Secure' | 'mailInPop3User' | 'mailInPop3Pass'>,
): Promise<InstanceType<typeof Pop3CommandType>> {
  const Pop3Command = await loadPop3Command()
  return new Pop3Command({
    host: tenant.mailInPop3Host!,
    port: tenant.mailInPop3Port,
    tls: tenant.mailInPop3Secure,
    user: tenant.mailInPop3User ?? '',
    password: tenant.mailInPop3Pass ?? '',
  })
}

/** Für den "Verbindung testen"-Knopf (Mandanten-Einstellungen): meldet sich an und zählt Nachrichten. */
export async function testPop3Mailbox(
  tenant: Pick<Tenant, 'mailInPop3Host' | 'mailInPop3Port' | 'mailInPop3Secure' | 'mailInPop3User' | 'mailInPop3Pass'>,
): Promise<{ messageCount: number }> {
  if (!tenant.mailInPop3Host) throw new Error('Kein Server eingetragen')
  const pop3 = await buildClient(tenant)
  try {
    const list = await pop3.LIST()
    return { messageCount: list.length }
  } finally {
    await pop3.QUIT().catch(() => undefined)
  }
}

/**
 * Fragt für alle dafür aktivierten Mandanten ihr konfiguriertes POP3-Postfach
 * ab — mit `tenantId` auf genau einen Mandanten eingeschränkt (manueller
 * "Jetzt abrufen"-Knopf, siehe api/mailin/poll/route.ts). `respectSchedule`
 * (Stefan 2026-08-27, eigenes Poll-Intervall je Mandant, siehe
 * lib/mailinSchedule.ts): beim automatischen Poller (Standard) übersprungen,
 * solange das eigene Intervall des Mandanten noch nicht abgelaufen ist — der
 * manuelle "Jetzt abrufen"-Knopf setzt `false` und ignoriert das bewusst.
 */
export async function runPop3MailinPoll(tenantId?: string, respectSchedule = true): Promise<string[]> {
  const log: string[] = []
  const s = await getSettings()
  if (s.MAIL_IN_POP3_ENABLED !== '1') return ['POP3-Mail-Eingang ist deaktiviert (Systemeinstellungen).']

  const allTenants: Pop3TenantFields[] = await prisma.tenant.findMany({
    where: { active: true, mailInPop3Enabled: true, mailInPop3Host: { not: null }, ...(tenantId ? { id: tenantId } : {}) },
  })
  if (allTenants.length === 0) return ['Kein Mandant hat den POP3-Mail-Eingang aktiviert.']
  const globalDefault = Number(s.MAIL_IN_POP3_POLL_SECONDS) || 300
  const tenants = respectSchedule ? allTenants.filter((t) => isMailinDue(t, globalDefault)) : allTenants
  if (tenants.length === 0) return []

  for (const tenant of tenants) {
    await markMailinPolled(tenant.id)
    const pop3 = await buildClient(tenant)
    let processed = 0
    try {
      const list = (await pop3.LIST()) as string[][] // [[msgNum, size], ...] (immer string[][] ohne msgNumber-Argument)
      for (const [msgNumStr] of list) {
        const msgNum = Number(msgNumStr)
        try {
          const raw = await pop3.RETR(msgNum)
          const parsed = await simpleParser(typeof raw === 'string' ? raw : '')
          const messageId = parsed.messageId || undefined
          if (messageId) {
            const already = await prisma.mailIntake.findFirst({
              where: { tenantId: tenant.id, sourceMessageId: messageId },
              select: { id: true },
            })
            if (already) {
              await pop3.DELE(msgNum).catch(() => undefined)
              continue
            }
          }
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
            tenant.mailInPop3User ?? tenant.mailInPop3Host!,
            subject,
            attachments,
            'POP3',
            messageId,
            typeof parsed.html === 'string' ? parsed.html : null,
            parsed.text ?? null,
          )
          processed += result.processed
          // Erst NACH erfolgreicher Verarbeitung löschen — bei einem Fehler oben
          // (catch unten) bleibt die Nachricht für den nächsten Poll erhalten.
          await pop3.DELE(msgNum)
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e)
          log.push(`${tenant.name}: Nachricht #${msgNum} übersprungen — ${detail}`)
        }
      }
      log.push(`${tenant.name}: ${processed} Beleg(e) von ${tenant.mailInPop3Host}.`)
    } catch (e) {
      const detail = friendlyMailinAuthError(e)
      log.push(`${tenant.name}: Fehler beim Abruf von ${tenant.mailInPop3Host} — ${detail}`)
    } finally {
      await pop3.QUIT().catch(() => undefined)
    }
  }
  return log
}
