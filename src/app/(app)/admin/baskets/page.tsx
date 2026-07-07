// Körbe-Verwaltung (§ Rechnungseingangsverarbeitung): Körbe anlegen, Mitarbeiter
// zuordnen, Vier-Augen-Prinzip und Sammel-Benachrichtigung je Korb einstellen.
import { Role } from '@prisma/client'
import { redirect } from 'next/navigation'
import { ensureSystemBaskets } from '@/lib/baskets'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { BasketAdmin } from './BasketAdmin'

export const dynamic = 'force-dynamic'

export default async function BasketsPage() {
  const ctx = await getContext()
  if (!ctx.tenantId) redirect('/platform')
  if (ctx.role !== Role.TENANT_ADMIN && ctx.role !== Role.OPERATOR_ADMIN) redirect('/dashboard')
  const tenantId = ctx.tenantId

  await ensureSystemBaskets(tenantId)

  const [baskets, users] = await Promise.all([
    prisma.basket.findMany({
      where: { tenantId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: {
        members: { include: { user: { select: { id: true, email: true, username: true } } } },
        _count: { select: { invoices: { where: { deletedAt: null } } } },
      },
    }),
    prisma.user.findMany({
      where: { tenantId, active: true },
      orderBy: { email: 'asc' },
      select: { id: true, email: true, username: true },
    }),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--fg)]">Körbe</h1>
        <p className="mt-1 text-sm text-gray-500">
          Rechnungen wandern durch Körbe wie in der klassischen Rechnungseingangsverarbeitung.
          Eingangskorb und Übergabekorb sind fest eingerichtet; dazwischen lassen sich beliebig
          viele eigene Körbe anlegen, optional mit Vier-Augen-Freigabe und einer
          Sammel-Benachrichtigung im gewünschten Stundenintervall.
        </p>
      </div>
      <BasketAdmin
        baskets={baskets.map((b) => ({
          id: b.id,
          name: b.name,
          kind: b.kind,
          fourEyesEnabled: b.fourEyesEnabled,
          notificationEnabled: b.notificationEnabled,
          notificationIntervalHours: b.notificationIntervalHours,
          invoiceCount: b._count.invoices,
          members: b.members.map((m) => ({ id: m.user.id, email: m.user.email, username: m.user.username })),
        }))}
        allUsers={users}
      />
    </div>
  )
}
