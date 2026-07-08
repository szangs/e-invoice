// Mandanten-Einstellungen (lokaler Administrator, §8)
import { Role } from '@prisma/client'
import { redirect } from 'next/navigation'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { SettingsHub } from './SettingsHub'

export const dynamic = 'force-dynamic'

export default async function TenantSettingsPage() {
  const ctx = await getContext()
  if (!ctx.tenantId) redirect('/platform')
  if (ctx.role !== Role.TENANT_ADMIN && ctx.role !== Role.OPERATOR_ADMIN) redirect('/dashboard')
  const tenantId = ctx.tenantId
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) return null

  return (
    <div className="max-w-xl space-y-6">
      <section className="dp-card">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">Ihr Mandant</h2>
        <p className="text-sm text-gray-700">{tenant.name}</p>
        <p className="text-xs text-gray-400">
          Kurzname: <span className="font-mono">{tenant.slug}</span> · Lizenz:{' '}
          {tenant.licensePlan ?? '—'} ·{' '}
          {tenant.licenseExpiresAt
            ? `bis ${tenant.licenseExpiresAt.toLocaleDateString('de-DE')}`
            : 'unbegrenzt'}
        </p>
      </section>
      <SettingsHub
        initial={{
          aiAllowed: tenant.aiAllowed,
          ipLoggingAllowed: tenant.ipLoggingAllowed,
          backupEnabled: tenant.backupEnabled,
          defaultLanguage: tenant.defaultLanguage,
          mailAllowedDomains: tenant.mailAllowedDomains ?? '',
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
          costCentersEnabled: tenant.costCentersEnabled,
        }}
        encryptionEnabled={tenant.encryptionEnabled}
        lastBackupAt={tenant.lastBackupAt ? tenant.lastBackupAt.toISOString() : null}
      />
    </div>
  )
}
