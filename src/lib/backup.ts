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

  // Mandanten
  const tenants = await prisma.tenant.findMany({ where: { backupEnabled: true, active: true } })
  for (const t of tenants) {
    if (!force && !isDue(t.lastBackupAt, t.backupFrequency)) continue
    try {
      const { filename, json } = await buildTenantBackup(t.id)
      let delivered = false
      if (t.backupEmail) {
        const mail = await sendSystemMail(
          t.backupEmail,
          `E-Invoice Datensicherung — ${t.name}`,
          `Guten Tag,\n\nanbei die automatische Datensicherung Ihres Mandanten "${t.name}".\nAufbewahrung gemäß Ihren eigenen Sicherungsregeln.\n`,
          [{ filename, content: json }],
        )
        delivered = mail.sent
        log.push(`${t.slug}: E-Mail an ${t.backupEmail} — ${mail.sent ? 'versendet' : mail.reason}`)
      }
      if (targetDir) {
        await mkdir(targetDir, { recursive: true })
        await writeFile(path.join(targetDir, filename), json)
        delivered = true
        log.push(`${t.slug}: Datei → ${path.join(targetDir, filename)}`)
      }
      if (delivered) {
        await prisma.tenant.update({ where: { id: t.id }, data: { lastBackupAt: new Date() } })
        await audit({
          tenantId: t.id,
          actorName: 'Sicherung',
          action: 'BACKUP_CREATED',
          details: `Automatische Sicherung erstellt (${t.backupFrequency})`,
        })
      } else if (!t.backupEmail && !targetDir) {
        log.push(`${t.slug}: kein Ziel konfiguriert (weder E-Mail noch Verzeichnis)`)
      }
    } catch (e) {
      log.push(`${t.slug}: FEHLER — ${e instanceof Error ? e.message : 'unbekannt'}`)
    }
  }

  // Gesamtsystem
  if (settings.BACKUP_SYSTEM_ENABLED === '1') {
    const last = settings.BACKUP_SYSTEM_LAST ? new Date(settings.BACKUP_SYSTEM_LAST) : null
    if (force || isDue(last, settings.BACKUP_SYSTEM_FREQ || 'WEEKLY')) {
      try {
        const { filename, json } = await buildSystemBackup()
        let delivered = false
        if (targetDir) {
          await mkdir(targetDir, { recursive: true })
          await writeFile(path.join(targetDir, filename), json)
          delivered = true
          log.push(`System: Datei → ${path.join(targetDir, filename)}`)
        }
        if (settings.BACKUP_SYSTEM_EMAIL) {
          const mail = await sendSystemMail(
            settings.BACKUP_SYSTEM_EMAIL,
            'E-Invoice System-Datensicherung',
            'Anbei die automatische Sicherung des Gesamtsystems.',
            [{ filename, content: json }],
          )
          delivered = delivered || mail.sent
          log.push(`System: E-Mail — ${mail.sent ? 'versendet' : mail.reason}`)
        }
        if (delivered) {
          await setSetting('BACKUP_SYSTEM_LAST', new Date().toISOString())
          await audit({ actorName: 'Sicherung', action: 'BACKUP_SYSTEM_CREATED', details: 'System-Sicherung erstellt' })
        } else {
          log.push('System: kein Ziel konfiguriert')
        }
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
