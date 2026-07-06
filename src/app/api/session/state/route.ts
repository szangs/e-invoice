// Sitzungszustand für den Client: Zwangsabmeldung (§10), Service-Status-Text (§9)
// und Fernwartungszustand (§14A). Wird vom SessionWatcher regelmäßig abgefragt.
import { NextResponse } from 'next/server'
import { Role, SupportStatus } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getSetting } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  const statusText = await getSetting('SERVICE_STATUS_TEXT')
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ authenticated: false, forcedLogout: false, statusText })
  }
  const u = session.user
  let forcedLogout = false
  if (u.role !== Role.OPERATOR_ADMIN && !u.impersonatorId) {
    const dbUser = await prisma.user.findUnique({
      where: { id: u.id },
      select: { forcedLogoutAt: true, active: true, tenant: { select: { active: true } } },
    })
    if (!dbUser || !dbUser.active) forcedLogout = true
    else if (dbUser.tenant && !dbUser.tenant.active) forcedLogout = true
    else if (dbUser.forcedLogoutAt && dbUser.forcedLogoutAt.getTime() > u.loginAt) forcedLogout = true
  }

  // Fernwartung (§14A): offene Betreiber-Anfrage (Einwilligung nötig) / eigene aktive Sitzung
  let supportRequestId: string | null = null
  let supportActiveId: string | null = null
  if (u.tenantId) {
    const [pending, active] = await Promise.all([
      prisma.supportSession.findFirst({
        where: { tenantId: u.tenantId, status: SupportStatus.REQUESTED, initiatedBy: 'OPERATOR' },
        select: { id: true },
      }),
      prisma.supportSession.findFirst({
        where: { userId: u.id, status: SupportStatus.ACTIVE },
        select: { id: true },
      }),
    ])
    supportRequestId = pending?.id ?? null
    supportActiveId = active?.id ?? null
  }

  return NextResponse.json({
    authenticated: true,
    forcedLogout,
    statusText,
    supportRequestId,
    supportActiveId,
  })
}
