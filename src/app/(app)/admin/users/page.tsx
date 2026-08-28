// Benutzerverwaltung des Mandanten (§8)
import { Role } from '@prisma/client'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { redirect } from 'next/navigation'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { getEffectiveRoleActionMatrix } from '@/lib/roleActions'
import { UserAdmin } from './UserAdmin'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const ctx = await getContext()
  // Betreiber ohne Mandanten-Kontext → Cockpit; andere Rollen → Dashboard (kein Absturz)
  if (!ctx.tenantId) redirect('/platform')
  if (ctx.role !== Role.TENANT_ADMIN && ctx.role !== Role.OPERATOR_ADMIN) redirect('/dashboard')
  const tenantId = ctx.tenantId
  const [users, tenant, groupsRaw] = await Promise.all([
    prisma.user.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    // Mitarbeiter-Gruppen (Stefan 2026-08-26, hierher verschoben von /admin/
    // baskets — Gruppen sind eine Mitarbeiter-Eigenschaft, Korb-Rechte für
    // Gruppen bleiben weiterhin in der Körbe-Verwaltung).
    prisma.employeeGroup.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: { members: { include: { user: { select: { id: true, email: true } } } } },
    }),
  ])
  const groups = groupsRaw.map((g) => ({
    id: g.id,
    name: g.name,
    members: g.members.map((m) => ({ id: m.user.id, email: m.user.email })),
  }))

  return (
    <div className="space-y-6">
      <UserAdmin
        maxUsers={tenant?.maxUsers ?? 0}
        currentCount={users.length}
        selfId={ctx.userId}
        users={users.map((u) => ({
          id: u.id,
          email: u.email,
          username: u.username,
          firstName: u.firstName,
          lastName: u.lastName,
          department: u.department,
          jobTitle: u.jobTitle,
          role: u.role,
          active: u.active,
          lastLogin: u.lastLoginAt ? format(u.lastLoginAt, 'dd.MM.yyyy HH:mm', { locale: de }) : '—',
        }))}
        groups={groups}
        roleActionMatrix={getEffectiveRoleActionMatrix(tenant?.roleActions)}
      />
    </div>
  )
}
