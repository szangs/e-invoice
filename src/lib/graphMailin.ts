// E-Mail-Eingang per Microsoft Graph (Alternative zum SMTP-Empfänger, "Variante A"):
// fragt für jeden dafür aktivierten Mandanten regelmäßig ein Postfach + einen
// Ordnerpfad ab, statt dass der Mandant eine Weiterleitung auf unsere
// SMTP-Subdomain einrichten muss. WICHTIG: nutzt die EIGENE Azure-App-Registrierung
// DES MANDANTEN (mailInGraphTenantId/-ClientId/-ClientSecret auf dem Tenant-Datensatz),
// nicht die Zugangsdaten des Betreibers — Anwendungsberechtigungen gelten nur
// innerhalb des Azure-AD-Tenants, in dem die App registriert ist, und der Betreiber
// betreut typischerweise viele voneinander unabhängige fremde Firmen. Standardmäßig
// rein lesend (Mail.Read) — Nachrichten werden weder als gelesen markiert noch
// verschoben. Optional (mailInGraphMoveToFolder gesetzt) werden verarbeitete
// Nachrichten in einen Zielordner verschoben — braucht dann zusätzlich
// "Mail.ReadWrite" statt nur "Mail.Read" in der Azure-App-Registrierung.
// Dublettenprüfung läuft unabhängig davon über MailIntake.sourceMessageId
// (siehe processInboundAttachments), damit eine Mail nie doppelt verarbeitet wird
// — egal ob/wohin sie zwischenzeitlich verschoben wurde.
import { type Tenant } from '@prisma/client'
import { prisma } from '@/lib/db'
import { type InboundAttachment, processInboundAttachments } from '@/lib/mailin'
import { getMsAccessToken } from '@/lib/msGraphAuth'
import { getSettings, isDevMode } from '@/lib/settings'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

async function graphGet(token: string, url: string): Promise<any> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Graph-Anfrage fehlgeschlagen (${res.status}): ${body.slice(0, 300)}`)
  }
  return res.json()
}

/**
 * Sucht einen Ordner mit gegebenem Namen (groß-/kleinschreibungsunabhängig) unter
 * `parentId` — bei `parentId = null` im Hauptverzeichnis des Postfachs (oberste
 * Ebene, gleiche Ebene wie "Posteingang"/"Gesendete Elemente"), sonst als
 * Unterordner von `parentId`. Kein $filter: die Mail-Ordner-API unterstützt weder
 * groß-/kleinschreibungsunabhängige OData-Funktionen wie tolower() noch
 * case-sensitives eq zuverlässig für den hiesigen Zweck.
 */
async function findChildFolder(
  token: string,
  mailbox: string,
  parentId: string | null,
  name: string,
): Promise<{ id: string; displayName?: string } | undefined> {
  const url = parentId
    ? `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/mailFolders/${encodeURIComponent(parentId)}/childFolders?$top=250&$select=id,displayName`
    : `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/mailFolders?$top=250&$select=id,displayName`
  const data = await graphGet(token, url)
  return (data.value ?? []).find((f: { displayName?: string }) => (f.displayName ?? '').toLowerCase() === name.toLowerCase())
}

/**
 * Löst einen Ordnerpfad in eine Graph-Ordner-ID auf. Leerer Pfad → Posteingang
 * (Well-known-Name "inbox"). Beginnt der Pfad mit "Posteingang"/"Inbox", wird
 * relativ dazu gesucht (z. B. "Posteingang/Rechnungen" = Unterordner von
 * Posteingang). Sonst wird der erste Abschnitt im HAUPTVERZEICHNIS des Postfachs
 * gesucht (eigener Ordner auf gleicher Ebene wie Posteingang, z. B. einfach
 * "Rechnungseingang") — weitere Pfad-Abschnitte danach als dessen Unterordner.
 */
export async function resolveGraphFolderId(token: string, mailbox: string, rawPath: string | null | undefined): Promise<string> {
  const segments = (rawPath ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  if (segments.length === 0) return 'inbox'

  let currentId: string | null = null // null = Hauptverzeichnis des Postfachs
  let remaining = segments
  if (/^(posteingang|inbox)$/i.test(segments[0])) {
    currentId = 'inbox'
    remaining = segments.slice(1)
  }

  for (const segment of remaining) {
    const found = await findChildFolder(token, mailbox, currentId, segment)
    if (!found) throw new Error(`Ordner "${segment}" nicht gefunden (Pfad: ${rawPath})`)
    currentId = found.id
  }
  return currentId ?? 'inbox'
}

type GraphMessage = {
  id: string
  subject?: string
  hasAttachments?: boolean
  from?: { emailAddress?: { address?: string; name?: string } }
}

async function fetchRecentMessages(token: string, mailbox: string, folderId: string, top = 25): Promise<GraphMessage[]> {
  // Älteste zuerst (nicht "desc"): sonst bleibt bei einem Rückstand > top immer
  // dieselbe Menge neuester Nachrichten im Fenster und ältere werden nie erreicht,
  // solange der Ordner nicht schrumpft (z. B. weil Verschieben fehlschlägt).
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/mailFolders/${encodeURIComponent(folderId)}/messages?$top=${top}&$orderby=receivedDateTime asc&$select=id,subject,from,hasAttachments`
  const data = await graphGet(token, url)
  return data.value ?? []
}

/** Verschiebt eine Nachricht in einen anderen Ordner — braucht "Mail.ReadWrite" (nicht nur "Mail.Read"). */
async function moveMessage(token: string, mailbox: string, messageId: string, destinationFolderId: string): Promise<void> {
  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/move`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ destinationId: destinationFolderId }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Verschieben fehlgeschlagen (${res.status}): ${body.slice(0, 300)}`)
  }
}

/**
 * Kennzeichnet eine verarbeitete Nachricht im Postfach mit ihrer/ihren
 * Dokumenten-ID(s) im Betreff (Stefan 2026-08-25) — leichtes Wiederfinden im
 * Postfach/"Verarbeitet"-Ordner, welche Mail zu welchem Beleg wurde. Braucht
 * "Mail.ReadWrite" (wie das Verschieben). Nur SMTP-unabhängig sinnvoll, da
 * nur hier ein echtes Postfach zum Bearbeiten existiert.
 */
async function tagMessageSubject(token: string, mailbox: string, messageId: string, docIds: string[], originalSubject: string): Promise<void> {
  if (docIds.length === 0) return
  const tag = `[${docIds.join(', ')}]`
  if (originalSubject.startsWith(tag)) return // schon getaggt (z. B. erneuter Lauf)
  const newSubject = `${tag} ${originalSubject}`.slice(0, 250)
  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: newSubject }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Betreff-Kennzeichnung fehlgeschlagen (${res.status}): ${body.slice(0, 300)}`)
  }
}

async function fetchAttachments(token: string, mailbox: string, messageId: string): Promise<InboundAttachment[]> {
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments`
  const data = await graphGet(token, url)
  const items: any[] = data.value ?? []
  return items
    .filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment' && !a.isInline && a.contentBytes)
    .map((a) => ({
      filename: a.name ?? 'anhang',
      contentType: a.contentType ?? 'application/octet-stream',
      content: Buffer.from(a.contentBytes, 'base64'),
    }))
}

/**
 * Lädt den Mailtext nach (Stefan 2026-08-25) — NUR wenn `fetchRecentMessages`
 * keine verwertbaren Anhänge fand, denn body ist im Nachrichten-Listing
 * bewusst NICHT selektiert (unnötig groß für den Normalfall mit Anhang).
 * Für HTML-Rechnungen ohne Anhang (Ausland/Drittland), siehe lib/mailin.ts.
 */
async function fetchMessageBody(token: string, mailbox: string, messageId: string): Promise<{ html: string | null; text: string | null }> {
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}?$select=body`
  const data = await graphGet(token, url)
  const contentType: string | undefined = data.body?.contentType
  const content: string | undefined = data.body?.content
  if (!content) return { html: null, text: null }
  return contentType === 'html' ? { html: content, text: null } : { html: null, text: content }
}

type GraphCredentials = { tenantId: string; clientId: string; clientSecret: string; source: 'tenant' | 'operator-test' }

/**
 * Liefert die Graph-Zugangsdaten für einen Mandanten: bevorzugt dessen eigene
 * (mailInGraphTenantId/-ClientId/-ClientSecret). Fehlen die, wird NUR im
 * Entwicklungsmodus (bestehender globaler Schalter, §24 — kein eigener
 * Test-Schalter nötig) auf die Betreiber-Zugangsdaten zurückgefallen — das
 * funktioniert nur für Postfächer im eigenen Azure-AD-Tenant des Betreibers,
 * niemals für echte externe Mandanten (siehe Kommentar am Dateianfang). Gibt
 * null zurück, wenn nichts verfügbar ist.
 */
export async function resolveGraphCredentials(
  tenant: Pick<Tenant, 'mailInGraphTenantId' | 'mailInGraphClientId' | 'mailInGraphClientSecret'>,
): Promise<GraphCredentials | null> {
  if (tenant.mailInGraphTenantId && tenant.mailInGraphClientId && tenant.mailInGraphClientSecret) {
    return {
      tenantId: tenant.mailInGraphTenantId,
      clientId: tenant.mailInGraphClientId,
      clientSecret: tenant.mailInGraphClientSecret,
      source: 'tenant',
    }
  }
  const s = await getSettings()
  if (await isDevMode() && s.MS_TENANT_ID && s.MS_CLIENT_ID && s.MS_CLIENT_SECRET) {
    return { tenantId: s.MS_TENANT_ID, clientId: s.MS_CLIENT_ID, clientSecret: s.MS_CLIENT_SECRET, source: 'operator-test' }
  }
  return null
}

/**
 * Legt eine Nachricht per Graph-API direkt IM Zielordner an (statt sie normal
 * zu versenden) — für "Testrechnungen senden": eine per sendMail verschickte
 * Mail landet zwar im Postfach, aber serverseitige Posteingangsregeln (z. B.
 * "nach Rechnungseingang verschieben") greifen bei per API gesendeter Post
 * beobachtbar oft nicht (Outlook wertet solche Regeln offenbar nur beim
 * "normalen" Transport-Zustellweg aus). Für Testzwecke daher den Umweg über
 * Senden + Regel ganz vermeiden und die Nachricht sofort dort erzeugen, wo der
 * Graph-Mail-Eingang-Poller sie erwartet. Braucht "Mail.ReadWrite" (Anlegen
 * einer Nachricht in einem beliebigen Ordner zählt als Schreibzugriff).
 */
export async function createGraphTestMessage(
  tenant: Pick<Tenant, 'mailInGraphTenantId' | 'mailInGraphClientId' | 'mailInGraphClientSecret'>,
  mailbox: string,
  folderPath: string | null | undefined,
  from: string,
  subject: string,
  text: string,
  attachments: { filename: string; contentType: string; content: Buffer }[],
  // HTML-Auslandsrechnung als Demo (Stefan 2026-08-25): gesetzt = Nachricht
  // bekommt DIESEN HTML-Inhalt als Body statt `text` (und i. d. R. leere
  // `attachments`) — simuliert eine Rechnung, die als reiner Mailtext ohne
  // Anhang ankommt (siehe lib/htmlToPdf.ts / lib/mailin.ts HTML-Fallback).
  htmlBody?: string,
): Promise<void> {
  const creds = await resolveGraphCredentials(tenant)
  if (!creds) throw new Error('Graph-Zugangsdaten nicht verfügbar')
  const token = await getMsAccessToken(creds.tenantId, creds.clientId, creds.clientSecret, 'https://graph.microsoft.com/.default')
  const folderId = await resolveGraphFolderId(token, mailbox, folderPath)
  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/mailFolders/${encodeURIComponent(folderId)}/messages`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        body: htmlBody ? { contentType: 'HTML', content: htmlBody } : { contentType: 'Text', content: text },
        from: { emailAddress: { address: from } },
        toRecipients: [{ emailAddress: { address: mailbox } }],
        isRead: false,
        attachments: attachments.map((a) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.filename,
          contentType: a.contentType,
          contentBytes: a.content.toString('base64'),
        })),
      }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Testrechnung konnte nicht im Ordner angelegt werden (${res.status}): ${body.slice(0, 300)}`)
  }
}

/** Für den "Ordner testen"-Button (Mandanten-Einstellungen): löst Quell- (und optional Ziel-)Ordner auf und zählt Nachrichten. */
export async function testGraphMailbox(
  tenant: Pick<Tenant, 'mailInGraphTenantId' | 'mailInGraphClientId' | 'mailInGraphClientSecret'>,
  mailbox: string,
  folderPath: string | null | undefined,
  moveToFolderPath?: string | null,
): Promise<{ folderId: string; messageCount: number; source: 'tenant' | 'operator-test'; moveToFolderResolved: boolean }> {
  const creds = await resolveGraphCredentials(tenant)
  if (!creds) {
    throw new Error('Eigene Microsoft-Graph-Zugangsdaten nicht konfiguriert (Tenant-ID/Client-ID/Client-Secret oben)')
  }
  const token = await getMsAccessToken(creds.tenantId, creds.clientId, creds.clientSecret, 'https://graph.microsoft.com/.default')
  const folderId = await resolveGraphFolderId(token, mailbox, folderPath)
  const messages = await fetchRecentMessages(token, mailbox, folderId, 5)
  let moveToFolderResolved = false
  if (moveToFolderPath) {
    await resolveGraphFolderId(token, mailbox, moveToFolderPath)
    moveToFolderResolved = true
  }
  return { folderId, messageCount: messages.length, source: creds.source, moveToFolderResolved }
}

/** Fragt für alle dafür aktivierten Mandanten ihr konfiguriertes Postfach/Ordner ab. */
export async function runGraphMailinPoll(): Promise<string[]> {
  const log: string[] = []
  const s = await getSettings()
  if (s.MAIL_IN_GRAPH_ENABLED !== '1') return ['Graph-Mail-Eingang ist deaktiviert (Systemeinstellungen).']

  const tenants = await prisma.tenant.findMany({
    where: { active: true, mailInGraphEnabled: true, mailInGraphMailbox: { not: null } },
  })
  if (tenants.length === 0) return ['Kein Mandant hat den Graph-Mail-Eingang aktiviert.']

  for (const tenant of tenants) {
    const mailbox = tenant.mailInGraphMailbox!
    const creds = await resolveGraphCredentials(tenant)
    if (!creds) {
      log.push(`${tenant.name}: eigene Graph-Zugangsdaten fehlen (Mandanten-Einstellungen) — übersprungen.`)
      continue
    }
    try {
      const token = await getMsAccessToken(creds.tenantId, creds.clientId, creds.clientSecret, 'https://graph.microsoft.com/.default')
      if (creds.source === 'operator-test') log.push(`${tenant.name}: ⚠ Entwicklungsmodus — nutzt Betreiber-Zugangsdaten statt eigener.`)
      const folderId = await resolveGraphFolderId(token, mailbox, tenant.mailInGraphFolder)
      const moveToFolderId = tenant.mailInGraphMoveToFolder
        ? await resolveGraphFolderId(token, mailbox, tenant.mailInGraphMoveToFolder)
        : null
      const messages = await fetchRecentMessages(token, mailbox, folderId)
      let processed = 0
      let moveAttempts = 0
      let moved = 0
      for (const msg of messages) {
        const already = await prisma.mailIntake.findFirst({
          where: { tenantId: tenant.id, sourceMessageId: msg.id },
          select: { id: true },
        })
        if (already) continue

        const from = msg.from?.emailAddress?.address?.toLowerCase() ?? 'unbekannt'
        const subject = (msg.subject ?? '').slice(0, 200)
        const attachments = msg.hasAttachments ? await fetchAttachments(token, mailbox, msg.id) : []
        // Body IMMER nachladen (Stefan 2026-08-25) — nicht nur als Fallback
        // für HTML-Rechnungen ohne Anhang, sondern auch als Begleittext bei
        // vorhandenem Anhang: relevante Zusatzinfos im Mailtext sollen nicht
        // verloren gehen (siehe lib/mailin.ts mailBodyText).
        const body = await fetchMessageBody(token, mailbox, msg.id)
        const result = await processInboundAttachments(
          tenant,
          from,
          mailbox,
          subject,
          attachments,
          'GRAPH',
          msg.id,
          body.html,
          body.text,
        )
        if (result.processed > 0) processed += result.processed

        if (result.docIds.length > 0) {
          try {
            await tagMessageSubject(token, mailbox, msg.id, result.docIds, subject)
          } catch (e) {
            const detail = e instanceof Error ? e.message : String(e)
            log.push(`${tenant.name}: Betreff-Kennzeichnung für "${subject || '(ohne Betreff)'}" fehlgeschlagen — ${detail}`)
          }
        }

        // Verschieben erst NACH erfolgreicher Verarbeitung/Protokollierung (MailIntake-Zeile
        // steht schon), damit eine Mail bei einem Verschiebe-Fehler nicht "verloren" wirkt —
        // die Dublettenprüfung über sourceMessageId funktioniert unabhängig vom Postfach-Ort.
        if (moveToFolderId) {
          moveAttempts++
          try {
            await moveMessage(token, mailbox, msg.id, moveToFolderId)
            moved++
          } catch (e) {
            const detail = e instanceof Error ? e.message : String(e)
            log.push(`${tenant.name}: Verschieben von "${subject || '(ohne Betreff)'}" fehlgeschlagen — ${detail}`)
          }
        }
      }
      const moveNote = moveToFolderId ? `, ${moved}/${moveAttempts} verschoben` : ''
      log.push(`${tenant.name}: ${processed} Beleg(e) aus ${mailbox}${tenant.mailInGraphFolder ? '/' + tenant.mailInGraphFolder : ''}${moveNote}.`)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      log.push(`${tenant.name}: Fehler beim Abruf von ${mailbox} — ${detail}`)
    }
  }
  return log
}
