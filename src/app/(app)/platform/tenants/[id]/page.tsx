// Mandant bearbeiten (§7) — Stammdaten, Lizenz, Schalter
import { notFound } from 'next/navigation'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { TenantEditForm } from './TenantEditForm'

export const dynamic = 'force-dynamic'

export default async function EditTenantPage({ params }: { params: { id: string } }) {
  await getContext({ operator: true })
  const tenant = await prisma.tenant.findUnique({ where: { id: params.id } })
  if (!tenant) notFound()

  return (
    <TenantEditForm
      tenant={{
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        contactName: tenant.contactName ?? '',
        contactEmail: tenant.contactEmail ?? '',
        street: tenant.street ?? '',
        zip: tenant.zip ?? '',
        city: tenant.city ?? '',
        employeeCount: String(tenant.employeeCount),
        maxUsers: String(tenant.maxUsers),
        licensePlan: tenant.licensePlan ?? '',
        licenseSerial: tenant.licenseSerial ?? '',
        licenseExpiresAt: tenant.licenseExpiresAt
          ? tenant.licenseExpiresAt.toISOString().slice(0, 10)
          : '',
        aiAllowed: tenant.aiAllowed,
        ipLoggingAllowed: tenant.ipLoggingAllowed,
        backupEnabled: tenant.backupEnabled,
        defaultLanguage: tenant.defaultLanguage,
        active: tenant.active,
      }}
    />
  )
}
