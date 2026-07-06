// Benutzerverwaltung des Mandanten (§8)
import { Role } from '@prisma/client'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { UserAdmin } from './UserAdmin'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
  const tenantId = requireTenant(ctx)
  const [users, tenant] = await Promise.all([
    prisma.user.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    prisma.tenant.findUnique({ where: { id: tenantId } }),
  ])

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
          role: u.role,
          active: u.active,
          lastLogin: u.lastLoginAt ? format(u.lastLoginAt, 'dd.MM.yyyy HH:mm', { locale: de }) : '—',
        }))}
      />
    </div>
  )
}
