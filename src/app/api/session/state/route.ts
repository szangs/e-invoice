// Sitzungszustand für den Client: Zwangsabmeldung (§10) + Service-Status-Text (§9)
// Wird vom SessionWatcher regelmäßig abgefragt.
import { NextResponse } from 'next/server'
import { Role } from '@prisma/client'
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
  // Betreiber und laufende Identitätsübernahme sind ausgenommen (§10)
  if (u.role !== Role.OPERATOR_ADMIN && !u.impersonatorId) {
    const dbUser = await prisma.user.findUnique({
      where: { id: u.id },
      select: { forcedLogoutAt: true, active: true, tenant: { select: { active: true } } },
    })
    if (!dbUser || !dbUser.active) forcedLogout = true
    else if (dbUser.tenant && !dbUser.tenant.active) forcedLogout = true
    else if (dbUser.forcedLogoutAt && dbUser.forcedLogoutAt.getTime() > u.loginAt) forcedLogout = true
  }
  return NextResponse.json({ authenticated: true, forcedLogout, statusText })
}
