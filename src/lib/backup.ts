// Datensicherung & Wiederherstellung (§17)
// - Mandanten-Sicherung: Stammdaten, Benutzer, Rechnungen, Mail-Verlauf + Belegdateien
//   (verschlüsselte Belege bleiben verschlüsselt — Zero-Knowledge bleibt gewahrt)
// - System-Sicherung: alle Mandanten + Systemeinstellungen
// - Robuste Wiederherstellung mit klaren Fehlermeldungen (§17)
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { Prisma } from '@prisma/client'
import { audit } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { sendSystemMail } from '@/lib/mail'
import { getSetting, getSettings, setSetting } from '@/lib/settings'

const BACKUP_VERSION = 1
export const MAX_RESTORE_BYTES = 50 * 1024 * 1024

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
export const FREQUENCY_MS: Record<Frequency, number> = {
  DAILY: 24 * 60 * 60 * 1000,
  WEEKLY: 7 * 24 * 60 * 60 * 1000,
  MONTHLY: 30 * 24 * 60 * 60 * 1000,
  YEARLY: 365 * 24 * 60 * 60 * 1000,
}

function uploadsDir(tenantId: string): string {
  return path.join(process.cwd(), 'uploads', tenantId)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(value: any): any {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (v instanceof Prisma.Decimal ? Number(v) : v)),
  )
}

// ── Mandanten-Sicherung erstellen ──
export async function buildTenantBackup(tenantId: string): Promise<{ filename: string; json: string }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) throw new Error('Mandant nicht gefunden')
  const [users, invoices, mailIntake] = await Promise.all([
    prisma.user.findMany({ where: { tenantId } }),
    prisma.invoice.findMany({ where: { tenantId } }),
    prisma.mailIntake.findMany({ where: { tenantId } }),
  ])

  // Belegdateien einsammeln (Base64) — verschlüsselte bleiben Chiffrat
  const files: Record<string, string> = {}
  for (const inv of invoices) {
    if (!inv.fileName) continue
    try {
      const buf = await readFile(path.join(uploadsDir(tenantId), path.basename(inv.fileName)))
      files[inv.fileName] = buf.toString('base64')
    } catch {
      /* Datei fehlt — Sicherung läuft trotzdem weiter */
    }
  }

  const payload = {
    kind: 'einvoice-tenant-backup',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    tenant: serialize(tenant),
    users: serialize(users),
    invoices: serialize(invoices),
    mailIntake: serialize(mailIntake),
    files,
  }
  const date = new Date().toISOString().slice(0, 10)
  return { filename: `einvoice-backup-${tenant.slug}-${date}.json`, json: JSON.stringify(payload) }
}

// ── System-Sicherung erstellen ──
export async function buildSystemBackup(): Promise<{ filename: string; json: string }> {
  const tenants = await prisma.tenant.findMany({ select: { id: true } })
  const tenantBackups = []
  for (const t of tenants) {
    const b = await buildTenantBackup(t.id)
    tenantBackups.push(JSON.parse(b.json))
  }
  const [settings, operators] = await Promise.all([
    prisma.systemSetting.findMany(),
    prisma.user.findMany({ where: { tenantId: null } }),
  ])
  const payload = {
    kind: 'einvoice-system-backup',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    settings: serialize(settings),
    operators: serialize(operators),
    tenants: tenantBackups,
  }
  const date = new Date().toISOString().slice(0, 10)
  return { filename: `einvoice-system-backup-${date}.json`, json: JSON.stringify(payload) }
}

// ── Wiederherstellung: Mandant ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function restoreTenantBackup(payload: any, targetTenantId: string): Promise<string> {
  if (payload?.kind !== 'einvoice-tenant-backup') {
    throw new Error('Ungültiges Format — das ist keine E-Invoice-Mandantensicherung.')
  }
  const target = await prisma.tenant.findUnique({ where: { id: targetTenantId } })
  if (!target) throw new Error('Ziel-Mandant nicht gefunden.')
  if (payload.tenant?.slug && payload.tenant.slug !== target.slug) {
    throw new Error(
      `Sicherung gehört zu Mandant "${payload.tenant.slug}", nicht zu "${target.slug}".`,
    )
  }

  // Stammdaten/Schalter zurückspielen (ID und Slug bleiben unangetastet)
  const t = payload.tenant ?? {}
  await prisma.tenant.update({
    where: { id: targetTenantId },
    data: {
      name: t.name ?? target.name,
      contactName: t.contactName ?? null,
      contactEmail: t.contactEmail ?? null,
      street: t.street ?? null,
      zip: t.zip ?? null,
      city: t.city ?? null,
      employeeCount: t.employeeCount ?? target.employeeCount,
      maxUsers: t.maxUsers ?? target.maxUsers,
      aiAllowed: Boolean(t.aiAllowed),
      ipLoggingAllowed: Boolean(t.ipLoggingAllowed),
      defaultLanguage: t.defaultLanguage ?? 'de',
      backupEnabled: Boolean(t.backupEnabled),
      backupFrequency: t.backupFrequency ?? null,
      backupEmail: t.backupEmail ?? null,
      mailAllowedDomains: t.mailAllowedDomains ?? null,
      encryptionEnabled: Boolean(t.encryptionEnabled),
      encSalt: t.encSalt ?? null,
      encWrappedDek: t.encWrappedDek ?? null,
      // Dokumenten-ID-Zähler: NIE verkleinern, sonst würden nach dem Restore
      // neu angelegte Belege wieder eine bereits vergebene docId bekommen
      // (z. B. beim Einspielen einer älteren Sicherung). Es gilt der größere
      // der beiden Werte — Bestand des Ziel-Mandanten oder Sicherungsstand.
      nextDocSeq: Math.max(target.nextDocSeq, Number(t.nextDocSeq ?? 0)),
    },
  })

  let usersRestored = 0
  for (const u of payload.users ?? []) {
    if (!u.username || !u.email || !u.passwordHash) continue
    await prisma.user.upsert({
      where: { username: u.username },
      update: { role: u.role, active: Boolean(u.active), passwordHash: u.passwordHash },
      create: {
        tenantId: targetTenantId,
        email: String(u.email).toLowerCase(),
        username: u.username,
        passwordHash: u.passwordHash,
        role: u.role ?? 'USER',
        active: Boolean(u.active),
      },
    })
    usersRestored++
  }

  let invoicesRestored = 0
  for (const inv of payload.invoices ?? []) {
    if (!inv.id || !inv.vendor) continue
    const data = {
      docId: inv.docId ?? null,
      vendor: inv.vendor,
      invoiceNumber: inv.invoiceNumber ?? null,
      invoiceDate: inv.invoiceDate ? new Date(inv.invoiceDate) : null,
      dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
      amountNet: inv.amountNet ?? null,
      amountTax: inv.amountTax ?? null,
      amountGross: inv.amountGross ?? null,
      currency: inv.currency ?? 'EUR',
      status: inv.status ?? 'NEW',
      tags: inv.tags ?? null,
      notes: inv.notes ?? null,
      fileName: inv.fileName ?? null,
      originalName: inv.originalName ?? null,
      mimeType: inv.mimeType ?? null,
      encrypted: Boolean(inv.encrypted),
      encOrigMime: inv.encOrigMime ?? null,
      docFormat: inv.docFormat ?? null,
      xmlData: inv.xmlData ?? null,
      validationOk: inv.validationOk ?? null,
      validationIssues: inv.validationIssues ?? null,
      source: inv.source ?? 'RESTORE',
    }
    await prisma.invoice.upsert({
      where: { id: inv.id },
      update: data,
      create: { id: inv.id, tenantId: targetTenantId, ...data },
    })
    invoicesRestored++
  }

  // Belegdateien zurückschreiben
  let filesRestored = 0
  const dir = uploadsDir(targetTenantId)
  await mkdir(dir, { recursive: true })
  for (const [name, b64] of Object.entries(payload.files ?? {})) {
    try {
      await writeFile(path.join(dir, path.basename(name)), Buffer.from(String(b64), 'base64'))
      filesRestored++
    } catch {
      /* einzelne Datei überspringen, Rest fortsetzen */
    }
  }

  const summary = `${usersRestored} Benutzer, ${invoicesRestored} Rechnungen, ${filesRestored} Belegdateien wiederhergestellt`
  await audit({
    tenantId: targetTenantId,
    actorName: 'Wiederherstellung',
    action: 'BACKUP_RESTORE',
    details: summary,
  })
  return summary
}

// ── Wiederherstellung: Gesamtsystem ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function restoreSystemBackup(payload: any): Promise<string> {
  if (payload?.kind !== 'einvoice-system-backup') {
    throw new Error('Ungültiges Format — das ist keine E-Invoice-Systemsicherung.')
  }
  for (const s of payload.settings ?? []) {
    if (!s.key) continue
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { value: String(s.value ?? '') },
      create: { key: s.key, value: String(s.value ?? '') },
    })
  }
  let tenantsRestored = 0
  const parts: string[] = []
  for (const tb of payload.tenants ?? []) {
    const slug = tb?.tenant?.slug
    if (!slug) continue
    // Mandant bei Bedarf neu anlegen, dann normale Mandanten-Wiederherstellung
    let tenant = await prisma.tenant.findUnique({ where: { slug } })
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: { slug, name: tb.tenant.name ?? slug },
      })
    }
    const summary = await restoreTenantBackup(tb, tenant.id)
    parts.push(`${slug}: ${summary}`)
    tenantsRestored++
  }
  await audit({
    actorName: 'Wiederherstellung',
    action: 'BACKUP_RESTORE_SYSTEM',
    details: `System-Sicherung eingespielt: ${tenantsRestored} Mandant(en)`,
  })
  return `${tenantsRestored} Mandant(en) wiederhergestellt. ${parts.join(' · ')}`
}

// ── Automatik: fällige Sicherungen ausführen (Scheduler + "Jetzt ausführen") ──
// Auch von report.ts genutzt (gleiche Fälligkeits-Logik für den Hash-Bericht).
export function isDue(last: Date | null, freq: string | null): boolean {
  if (!freq || !(freq in FREQUENCY_MS)) return false
  if (!last) return true
  return Date.now() - last.getTime() >= FREQUENCY_MS[freq as Frequency]
}

export async function runDueBackups(force = false): Promise<string[]> {
  const log: string[] = []
  const settings = await getSettings()
  const targetDir = settings.BACKUP_TARGET_DIR

  // Mandanten — Stefan 2026-07-08: die Sicherung wird nicht mehr als
  // E-Mail-Anhang verschickt, sondern als ZIP-Paket serverseitig abgelegt
  // (siehe lib/backupPackage.ts); die E-Mail enthält nur noch den
  // Download-Link. Das Paket gilt als erstellt, sobald es auf der Platte
  // liegt — unabhängig vom Erfolg der Hinweis-Mail (die ist nur Benachrichtigung,
  // nicht mehr der Transportweg selbst).
  const tenants = await prisma.tenant.findMany({ where: { backupEnabled: true, active: true } })
  for (const t of tenants) {
    if (!force && !isDue(t.lastBackupAt, t.backupFrequency)) continue
    try {
      const { buildTenantBackupZip, storeBackupPackage, uploadToWebdav } = await import('@/lib/backupPackage')
      const { buffer, originalName, sha256 } = await buildTenantBackupZip(t.id)
      const pkg = await storeBackupPackage({ tenantId: t.id, kind: 'TENANT', buffer, originalName, sha256 })
      log.push(`${t.slug}: Paket erstellt (${originalName}, ${(buffer.length / 1024 / 1024).toFixed(1)} MB)`)

      if (targetDir) {
        await mkdir(targetDir, { recursive: true })
        await writeFile(path.join(targetDir, originalName), buffer)
        log.push(`${t.slug}: zusätzlich → ${path.join(targetDir, originalName)}`)
      }

      if (t.backupWebdavUrl) {
        const remote = await uploadToWebdav(t, buffer, originalName)
        await prisma.backupPackage.update({
          where: { id: pkg.id },
          data: remote.ok ? { remoteStoredAt: new Date() } : { remoteError: remote.error },
        })
        log.push(`${t.slug}: externes Ziel — ${remote.ok ? 'hochgeladen' : `fehlgeschlagen (${remote.error})`}`)
      }

      let mailSent = false
      if (t.backupEmail) {
        const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
        const downloadUrl = `${appUrl}/backup-download/${pkg.downloadToken}`
        const reminderLine = t.backupReminderDays && t.backupReminderDays > 0
          ? `\nSolange die Datei nicht heruntergeladen wurde, erinnern wir Sie alle paar Tage — bis zu ${t.backupReminderDays} Tage lang.`
          : ''
        const mail = await sendSystemMail(
          t.backupEmail,
          `E-Invoice Datensicherung bereit — ${t.name}`,
          [
            'Guten Tag,', '',
            `Ihre automatische Datensicherung "${t.name}" steht zum Download bereit.`, '',
            `Download-Link: ${downloadUrl}`,
            `SHA-256-Prüfsumme: ${sha256}`,
            `Verfügbar bis: ${pkg.expiresAt.toLocaleDateString('de-DE')}`,
            reminderLine, '',
            'Bitte speichern Sie die Datei an einem sicheren, von E-Invoice unabhängigen Ort.',
          ].join('\n'),
        )
        mailSent = mail.sent
        log.push(`${t.slug}: E-Mail an ${t.backupEmail} — ${mail.sent ? 'versendet' : mail.reason}`)
      } else {
        log.push(`${t.slug}: keine Ziel-E-Mail hinterlegt — Paket liegt bereit, niemand benachrichtigt`)
      }

      // Das Sicherungspaket selbst ist erstellt und sicher abgelegt — das
      // zählt als "Sicherung erfolgt", unabhängig vom Mail-Erfolg (anders als
      // im alten Anhang-Modell, wo die Mail der einzige Transportweg war).
      await prisma.tenant.update({ where: { id: t.id }, data: { lastBackupAt: new Date() } })
      await audit({
        tenantId: t.id,
        actorName: 'Sicherung',
        action: 'BACKUP_CREATED',
        details: `Automatisches Sicherungspaket erstellt (${t.backupFrequency}): ${originalName}, SHA-256 ${sha256.slice(0, 16)}…` +
          (mailSent ? '' : ' — Hinweis-Mail nicht zugestellt, siehe BACKUP_MAIL_FAILED'),
      })
      if (t.backupEmail && !mailSent) {
        await audit({
          tenantId: t.id,
          actorName: 'Sicherung',
          action: 'BACKUP_MAIL_FAILED',
          details: `Zustellungs-Mail für Paket ${originalName} fehlgeschlagen`,
        })
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'unbekannt'
      log.push(`${t.slug}: FEHLER — ${reason}`)
      await audit({ tenantId: t.id, actorName: 'Sicherung', action: 'BACKUP_FAILED', details: `Fehler: ${reason}` })
    }
  }

  // Gesamtsystem — ebenfalls als ZIP-Paket mit Download-Link statt Anhang.
  if (settings.BACKUP_SYSTEM_ENABLED === '1') {
    const last = settings.BACKUP_SYSTEM_LAST ? new Date(settings.BACKUP_SYSTEM_LAST) : null
    if (force || isDue(last, settings.BACKUP_SYSTEM_FREQ || 'WEEKLY')) {
      try {
        const { buildSystemBackupZip, storeBackupPackage } = await import('@/lib/backupPackage')
        const { buffer, originalName, sha256 } = await buildSystemBackupZip()
        const pkg = await storeBackupPackage({ tenantId: null, kind: 'SYSTEM', buffer, originalName, sha256 })
        log.push(`System: Paket erstellt (${originalName}, ${(buffer.length / 1024 / 1024).toFixed(1)} MB)`)

        if (targetDir) {
          await mkdir(targetDir, { recursive: true })
          await writeFile(path.join(targetDir, originalName), buffer)
          log.push(`System: zusätzlich → ${path.join(targetDir, originalName)}`)
        }
        if (settings.BACKUP_SYSTEM_EMAIL) {
          const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
          const downloadUrl = `${appUrl}/backup-download/${pkg.downloadToken}`
          const mail = await sendSystemMail(
            settings.BACKUP_SYSTEM_EMAIL,
            'E-Invoice System-Datensicherung bereit',
            `Download-Link: ${downloadUrl}\nSHA-256-Prüfsumme: ${sha256}\nVerfügbar bis: ${pkg.expiresAt.toLocaleDateString('de-DE')}`,
          )
          log.push(`System: E-Mail — ${mail.sent ? 'versendet' : mail.reason}`)
        }
        await setSetting('BACKUP_SYSTEM_LAST', new Date().toISOString())
        await audit({ actorName: 'Sicherung', action: 'BACKUP_SYSTEM_CREATED', details: `System-Sicherungspaket erstellt: ${originalName}` })
      } catch (e) {
        log.push(`System: FEHLER — ${e instanceof Error ? e.message : 'unbekannt'}`)
      }
    }
  }
  return log
}

export async function getBackupTargetInfo(): Promise<string> {
  return (await getSetting('BACKUP_TARGET_DIR')) || '(kein Verzeichnis konfiguriert)'
}
