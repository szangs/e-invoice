// Körbe-Verwaltung (§ Rechnungseingangsverarbeitung): Körbe anlegen, Mitarbeiter
// zuordnen, Vier-Augen-Prinzip und Sammel-Benachrichtigung je Korb einstellen.
import { Role } from '@prisma/client'
import { redirect } from 'next/navigation'
import { ensureSystemBaskets, sortBaskets } from '@/lib/baskets'
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

  const [basketsRaw, deletedBasketsRaw, users] = await Promise.all([
    prisma.basket.findMany({
      where: { tenantId, deletedAt: null },
      include: {
        members: { include: { user: { select: { id: true, email: true, username: true } } } },
        userRights: { select: { userId: true, right: true, user: { select: { email: true } } } },
        _count: { select: { invoices: { where: { deletedAt: null } } } },
      },
    }),
    // Papierkorb für Körbe (Stefan 2026-07-08) — nur leere Körbe können
    // gelöscht werden, landen dann hier und lassen sich wiederherstellen.
    prisma.basket.findMany({
      where: { tenantId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: { id: true, name: true, kind: true, deletedAt: true },
    }),
    prisma.user.findMany({
      where: { tenantId, active: true },
      orderBy: { email: 'asc' },
      select: { id: true, email: true, username: true, role: true },
    }),
  ])
  const baskets = sortBaskets(basketsRaw)

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
          rights: b.userRights.map((r) => ({ userId: r.userId, email: r.user.email, right: r.right })),
        }))}
        allUsers={users}
        rightsUsers={users.filter((u) => u.role !== Role.TENANT_ADMIN && u.role !== Role.OPERATOR_ADMIN)}
        deletedBaskets={deletedBasketsRaw.map((b) => ({
          id: b.id,
          name: b.name,
          kind: b.kind,
          deletedAt: b.deletedAt!.toISOString(),
        }))}
      />
    </div>
  )
}
