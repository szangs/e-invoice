// Mandanten-Einstellungen (lokaler Administrator, §8)
import { Role } from '@prisma/client'
import { redirect } from 'next/navigation'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { EncryptionSetup } from './EncryptionSetup'
import { TenantSwitches } from './TenantSwitches'
import { TokenManager } from './TokenManager'

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
      <TenantSwitches
        initial={{
          aiAllowed: tenant.aiAllowed,
          ipLoggingAllowed: tenant.ipLoggingAllowed,
          backupEnabled: tenant.backupEnabled,
          defaultLanguage: tenant.defaultLanguage,
          mailAllowedDomains: tenant.mailAllowedDomains ?? '',
        }}
      />
      <EncryptionSetup />
      <TokenManager />
    </div>
  )
}
