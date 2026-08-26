// Mandanten-Einstellungen (lokaler Administrator, §8)
import { Role } from '@prisma/client'
import { redirect } from 'next/navigation'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { SettingsHub } from './SettingsHub'

export const dynamic = 'force-dynamic'

export default async function TenantSettingsPage() {
  const ctx = await getContext()
  if (!ctx.tenantId) redirect('/platform')
  if (ctx.role !== Role.TENANT_ADMIN && ctx.role !== Role.OPERATOR_ADMIN) redirect('/dashboard')
  const tenantId = ctx.tenantId
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return null

  const globalSettings = await getSettings()
  const mailInDomain = globalSettings.MAIL_IN_DOMAIN
  const mailInAddress = mailInDomain
    ? `${globalSettings.MAIL_IN_PREFIX || ''}${tenant.slug}@${mailInDomain}`
    : null
  // E-Mail-Eingang (Stefan 2026-08-25): Adresse + Erklärtext hierher verschoben
  // von der bisherigen eigenständigen /mailin-Seite (der Verlauf steht jetzt
  // im Audit-Protokoll) — gehört inhaltlich zu den Mandanten-Einstellungen,
  // nicht in einen eigenen Menüpunkt.
  const mailInGraphActive =
    globalSettings.MAIL_IN_GRAPH_ENABLED === '1' && tenant.mailInGraphEnabled && !!tenant.mailInGraphMailbox
  const mailInSmtpEnabled = globalSettings.MAIL_SMTP_ENABLED === '1'

  return (
    <div className="max-w-xl space-y-6">
      <SettingsHub
        tenant={{
          name: tenant.name,
          slug: tenant.slug,
          licensePlan: tenant.licensePlan,
          licenseExpiresAt: tenant.licenseExpiresAt ? tenant.licenseExpiresAt.toISOString() : null,
          mailInAddress,
          mailInDomain,
          mailInSmtpEnabled,
          mailInGraphActive,
          mailInGraphMailbox: tenant.mailInGraphMailbox,
          mailInGraphFolder: tenant.mailInGraphFolder,
        }}
        initial={{
          legalName: tenant.legalName ?? '',
          buyerNameMismatchBlocksHandover: tenant.buyerNameMismatchBlocksHandover,
          aiAllowed: tenant.aiAllowed,
          ipLoggingAllowed: tenant.ipLoggingAllowed,
          backupEnabled: tenant.backupEnabled,
          defaultLanguage: tenant.defaultLanguage,
          mailAllowedDomains: tenant.mailAllowedDomains ?? '',
          mailInGraphEnabled: tenant.mailInGraphEnabled,
          mailInGraphMailbox: tenant.mailInGraphMailbox ?? '',
          mailInGraphFolder: tenant.mailInGraphFolder ?? '',
          mailInGraphMoveToFolder: tenant.mailInGraphMoveToFolder ?? '',
          spamReplyEnabled: tenant.spamReplyEnabled,
          autoDeleteExactDuplicates: tenant.autoDeleteExactDuplicates,
          autoSupersedeInvoiceVersions: tenant.autoSupersedeInvoiceVersions,
          mailInGraphTenantId: tenant.mailInGraphTenantId ?? '',
          mailInGraphClientId: tenant.mailInGraphClientId ?? '',
          mailInGraphClientSecret: tenant.mailInGraphClientSecret ?? '',
          backupFrequency: tenant.backupFrequency ?? 'WEEKLY',
          backupEmail: tenant.backupEmail ?? '',
          backupReminderDays: tenant.backupReminderDays ?? 14,
          backupWebdavUrl: tenant.backupWebdavUrl ?? '',
          backupWebdavUser: tenant.backupWebdavUser ?? '',
          backupWebdavPass: tenant.backupWebdavPass ?? '',
          reportEnabled: tenant.reportEnabled,
          reportFrequency: tenant.reportFrequency ?? 'MONTHLY',
          reportEmail: tenant.reportEmail ?? '',
          datevBeraternr: tenant.datevBeraternr ?? '',
          datevMandantnr: tenant.datevMandantnr ?? '',
          datevSkr: tenant.datevSkr ?? 'SKR04',
          datevSachkontenlaenge: tenant.datevSachkontenlaenge ?? 4,
          datevKreditorenkonto: tenant.datevKreditorenkonto ?? '',
          datevGegenkonto: tenant.datevGegenkonto ?? '',
          datevWjBeginn: tenant.datevWjBeginn ?? '0101',
          datevFibuEmail: tenant.datevFibuEmail ?? '',
          costCenterEnabled: tenant.costCenterEnabled,
          costCarrierEnabled: tenant.costCarrierEnabled,
          dueReminderDaysAfterReceipt: tenant.dueReminderDaysAfterReceipt,
          dueReminderDaysBeforeDue: tenant.dueReminderDaysBeforeDue,
        }}
        encryptionEnabled={tenant.encryptionEnabled}
        lastBackupAt={tenant.lastBackupAt ? tenant.lastBackupAt.toISOString() : null}
      />
    </div>
  )
}
