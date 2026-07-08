// Sicherungspakete (§17, Stefan 2026-07-08): baut aus den bestehenden
// JSON-Sicherungen (lib/backup.ts) ein ZIP-Paket mit SHA-256-Prüfsumme und den
// Original-Belegdateien als eigenständige Dateien (statt Base64 in einer
// riesigen JSON-Datei), legt es serverseitig unter einem Zufalls-Token ab und
// liefert nur noch einen Download-Link per E-Mail aus — nicht mehr das Paket
// selbst als Anhang. Optional zusätzlich Kopie auf ein externes WebDAV-Ziel.
import AdmZip from 'adm-zip'
import { createHash, randomBytes } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { audit } from '@/lib/audit'
import { buildSystemBackup, buildTenantBackup } from '@/lib/backup'
import { prisma } from '@/lib/db'
import { sendSystemMail } from '@/lib/mail'

// Ablage getrennt von uploads/ (Beleg-Dateien) — Sicherungspakete sind
// vollständige Datenexporte mit eigener Aufbewahrungs-/Zugriffslogik (Token,
// Ablaufdatum), keine einzelnen Belege.
const STORE_DIR = path.join(process.cwd(), 'backup-packages')
// Download-Link bleibt 90 Tage gültig — danach räumt sich das Paket praktisch
// selbst auf (Datei bleibt liegen, der Link liefert aber "abgelaufen").
const EXPIRY_DAYS = 90
// Erinnerungs-Abstand, solange innerhalb von tenant.backupReminderDays und
// noch nicht heruntergeladen.
const REMIND_EVERY_MS = 3 * 24 * 60 * 60 * 1000

type ZipResult = { buffer: Buffer; originalName: string; sha256: string }

function finalizeZip(zip: AdmZip, baseFilename: string): ZipResult {
  const buffer = zip.toBuffer()
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const originalName = baseFilename.replace(/\.json$/, `-${sha256.slice(0, 8)}.zip`)
  return { buffer, originalName, sha256 }
}

const README = [
  'E-Invoice Datensicherung',
  '',
  'daten.json enthält die Mandanten-Stammdaten, Benutzer, Rechnungsdatensätze und den Mail-Verlauf.',
  'belege/ enthält die Original-Belegdateien (verschlüsselte Belege bleiben als Chiffrat erhalten).',
  '',
  'Die SHA-256-Prüfsumme dieser ZIP-Datei steht in der Zustellungs-E-Mail bzw. auf der Download-Seite',
  'und im Dateinamen (letzte 8 Zeichen vor .zip) — damit lässt sich die Unversehrtheit jederzeit prüfen.',
  '',
].join('\n')

/** Baut das ZIP-Sicherungspaket eines einzelnen Mandanten. */
export async function buildTenantBackupZip(tenantId: string): Promise<ZipResult> {
  const { filename, json } = await buildTenantBackup(tenantId)
  const payload = JSON.parse(json)
  const files: Record<string, string> = payload.files ?? {}
  const meta = { ...payload }
  delete meta.files

  const zip = new AdmZip()
  zip.addFile('LIESMICH.txt', Buffer.from(README, 'utf8'))
  zip.addFile('daten.json', Buffer.from(JSON.stringify(meta, null, 2), 'utf8'))
  for (const [name, b64] of Object.entries(files)) {
    zip.addFile(`belege/${name}`, Buffer.from(b64, 'base64'))
  }
  return finalizeZip(zip, filename)
}

/** Baut das ZIP-Sicherungspaket des Gesamtsystems (alle Mandanten + Systemeinstellungen). */
export async function buildSystemBackupZip(): Promise<ZipResult> {
  const { filename, json } = await buildSystemBackup()
  const payload = JSON.parse(json)
  const tenants: Array<Record<string, unknown>> = payload.tenants ?? []

  const zip = new AdmZip()
  zip.addFile('LIESMICH.txt', Buffer.from(README, 'utf8'))
  const metaTenants = tenants.map((t) => {
    const { files, ...rest } = t as { files?: Record<string, string> }
    return rest
  })
  zip.addFile('daten.json', Buffer.from(JSON.stringify({ ...payload, tenants: metaTenants }, null, 2), 'utf8'))
  for (const t of tenants) {
    const slug = ((t as { tenant?: { slug?: string } }).tenant?.slug) ?? 'mandant'
    const files = (t as { files?: Record<string, string> }).files ?? {}
    for (const [name, b64] of Object.entries(files)) {
      zip.addFile(`belege/${slug}/${name}`, Buffer.from(b64, 'base64'))
    }
  }
  return finalizeZip(zip, filename)
}

/** Legt das fertige ZIP-Paket ab und erstellt den Datenbank-Datensatz (Download-Token). */
export async function storeBackupPackage(params: {
  tenantId: string | null
  kind: 'TENANT' | 'SYSTEM'
  buffer: Buffer
  originalName: string
  sha256: string
}) {
  const token = randomBytes(24).toString('hex')
  const dir = path.join(STORE_DIR, params.tenantId ?? 'system')
  await mkdir(dir, { recursive: true })
  const fileName = `${token}.zip`
  await writeFile(path.join(dir, fileName), params.buffer)
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000)
  return prisma.backupPackage.create({
    data: {
      tenantId: params.tenantId,
      kind: params.kind,
      fileName,
      originalName: params.originalName,
      sha256: params.sha256,
      sizeBytes: params.buffer.length,
      downloadToken: token,
      expiresAt,
    },
  })
}

export async function readBackupPackageFile(pkg: { tenantId: string | null; fileName: string }): Promise<Buffer> {
  return readFile(path.join(STORE_DIR, pkg.tenantId ?? 'system', pkg.fileName))
}

/** Lädt das Paket zusätzlich auf ein per WebDAV erreichbares externes Ziel hoch (optional). */
export async function uploadToWebdav(
  tenant: { backupWebdavUrl: string | null; backupWebdavUser: string | null; backupWebdavPass: string | null },
  buffer: Buffer,
  filename: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!tenant.backupWebdavUrl) return { ok: false, error: 'kein externes Ziel konfiguriert' }
  try {
    const base = tenant.backupWebdavUrl.replace(/\/+$/, '')
    const url = `${base}/${encodeURIComponent(filename)}`
    const headers: Record<string, string> = { 'Content-Type': 'application/zip' }
    if (tenant.backupWebdavUser) {
      const cred = Buffer.from(`${tenant.backupWebdavUser}:${tenant.backupWebdavPass ?? ''}`).toString('base64')
      headers.Authorization = `Basic ${cred}`
    }
    const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(buffer) })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unbekannter Fehler' }
  }
}

function appUrl(): string {
  return process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
}

function humanSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Baut, speichert und verteilt das Sicherungspaket eines Mandanten — das ist
 * die neue gemeinsame Zustell-Logik für den Scheduler (runDueBackups) UND für
 * den manuellen "Jetzt senden"-Button (POST /api/admin/backup). Das Paket
 * gilt bereits als sicher erstellt, sobald es auf der Platte + in der
 * Datenbank liegt — unabhängig davon, ob die Hinweis-Mail zugestellt werden
 * konnte (das war beim alten Anhang-Modell noch dasselbe).
 */
export async function deliverTenantBackupPackage(tenant: {
  id: string
  slug: string
  name: string
  backupFrequency: string | null
  backupEmail: string | null
  backupWebdavUrl: string | null
  backupWebdavUser: string | null
  backupWebdavPass: string | null
  backupReminderDays: number | null
}): Promise<{ log: string[]; mailSent: boolean; downloadUrl: string }> {
  const log: string[] = []
  const { buffer, originalName, sha256 } = await buildTenantBackupZip(tenant.id)
  const pkg = await storeBackupPackage({ tenantId: tenant.id, kind: 'TENANT', buffer, originalName, sha256 })
  log.push(`Paket erstellt: ${originalName} (${humanSize(buffer.length)})`)

  if (tenant.backupWebdavUrl) {
    const remote = await uploadToWebdav(tenant, buffer, originalName)
    await prisma.backupPackage.update({
      where: { id: pkg.id },
      data: remote.ok ? { remoteStoredAt: new Date() } : { remoteError: remote.error },
    })
    log.push(`Externes Ziel: ${remote.ok ? 'hochgeladen' : `fehlgeschlagen (${remote.error})`}`)
  }

  const downloadUrl = `${appUrl()}/backup-download/${pkg.downloadToken}`
  let mailSent = false
  if (tenant.backupEmail) {
    const reminderLine = tenant.backupReminderDays && tenant.backupReminderDays > 0
      ? `\nSolange die Datei nicht heruntergeladen wurde, erinnern wir Sie alle paar Tage — bis zu ${tenant.backupReminderDays} Tage lang.`
      : ''
    const mail = await sendSystemMail(
      tenant.backupEmail,
      `E-Invoice Datensicherung bereit — ${tenant.name}`,
      [
        'Guten Tag,',
        '',
        `Ihre Datensicherung "${tenant.name}" steht zum Download bereit.`,
        '',
        `Download-Link: ${downloadUrl}`,
        `SHA-256-Prüfsumme: ${sha256}`,
        `Größe: ${humanSize(buffer.length)}`,
        `Verfügbar bis: ${pkg.expiresAt.toLocaleDateString('de-DE')}`,
        reminderLine,
        '',
        'Bitte speichern Sie die Datei an einem sicheren, von E-Invoice unabhängigen Ort.',
      ].join('\n'),
    )
    mailSent = mail.sent
    log.push(`E-Mail an ${tenant.backupEmail}: ${mail.sent ? 'versendet' : mail.reason}`)
    if (!mail.sent) {
      await audit({
        tenantId: tenant.id,
        actorName: 'Sicherung',
        action: 'BACKUP_MAIL_FAILED',
        details: `Zustellungs-Mail für Paket ${originalName} fehlgeschlagen: ${mail.reason}`,
      })
    }
  } else {
    log.push('Keine Ziel-E-Mail hinterlegt — Paket liegt bereit, aber niemand wurde benachrichtigt.')
  }

  return { log, mailSent, downloadUrl }
}

/**
 * Erinnert an noch nicht heruntergeladene Sicherungspakete, solange innerhalb
 * des mandantenspezifischen Erinnerungsfensters (backupReminderDays). Läuft
 * im selben Scheduler-Takt wie Sicherung/Bericht/Korb-Benachrichtigung.
 */
export async function runBackupReminders(force = false): Promise<string[]> {
  const log: string[] = []
  const now = new Date()
  const pending = await prisma.backupPackage.findMany({
    where: {
      downloadedAt: null,
      expiresAt: { gt: now },
      tenantId: { not: null },
      tenant: { is: { backupReminderDays: { not: null, gt: 0 } } },
    },
    include: {
      tenant: { select: { id: true, slug: true, name: true, backupEmail: true, backupReminderDays: true } },
    },
  })

  for (const pkg of pending) {
    const tenant = pkg.tenant
    if (!tenant || !tenant.backupEmail) continue
    const days = tenant.backupReminderDays ?? 0
    if (days <= 0) continue
    const ageMs = now.getTime() - pkg.createdAt.getTime()
    if (ageMs > days * 24 * 60 * 60 * 1000) continue // Erinnerungsfenster abgelaufen
    if (!force && pkg.lastReminderAt && now.getTime() - pkg.lastReminderAt.getTime() < REMIND_EVERY_MS) continue

    const downloadUrl = `${appUrl()}/backup-download/${pkg.downloadToken}`
    const mail = await sendSystemMail(
      tenant.backupEmail,
      `Erinnerung: Datensicherung noch nicht heruntergeladen — ${tenant.name}`,
      [
        'Guten Tag,',
        '',
        `die Datensicherung vom ${pkg.createdAt.toLocaleDateString('de-DE')} wurde noch nicht heruntergeladen.`,
        '',
        `Download-Link: ${downloadUrl}`,
        `Verfügbar bis: ${pkg.expiresAt.toLocaleDateString('de-DE')}`,
        '',
        'Sobald Sie die Datei heruntergeladen haben, endet diese Erinnerung automatisch.',
      ].join('\n'),
    )
    if (mail.sent) {
      await prisma.backupPackage.update({
        where: { id: pkg.id },
        data: { lastReminderAt: now, reminderCount: { increment: 1 } },
      })
      log.push(`${tenant.slug}: Erinnerung gesendet`)
    } else {
      log.push(`${tenant.slug}: Erinnerung fehlgeschlagen (${mail.reason})`)
    }
  }
  return log
}
