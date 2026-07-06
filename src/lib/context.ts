// Sitzungs-Kontext (§5): liefert jeder Schnittstelle den geprüften Kontext
// (Mandanten-ID, Benutzer-ID, Rolle). Ohne gültigen Kontext → Abweisung.
// Prüft beiläufig Zwangsabmeldung (§10) und aktualisiert "zuletzt gesehen" (gedrosselt).
import { Role } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type Ctx = {
  userId: string
  email: string
  role: Role
  tenantId: string | null
  tenantSlug: string | null
  tenantName: string | null
  impersonatorId: string | null
  impersonatorName: string | null
}

const SEEN_THROTTLE_MS = 60_000
const lastSeenCache = new Map<string, number>()

export async function getContext(opts?: { roles?: Role[]; operator?: boolean }): Promise<Ctx> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) throw new ApiError(401, 'Nicht angemeldet')
  const u = session.user

  // Zwangsabmeldung (§10): Betreiber und laufende Identitätsübernahme sind ausgenommen
  const isOperator = u.role === Role.OPERATOR_ADMIN
  if (!isOperator && !u.impersonatorId) {
    const dbUser = await prisma.user.findUnique({
      where: { id: u.id },
      select: { forcedLogoutAt: true, active: true, tenant: { select: { active: true } } },
    })
    if (!dbUser || !dbUser.active) throw new ApiError(401, 'Konto deaktiviert')
    if (dbUser.tenant && !dbUser.tenant.active) throw new ApiError(401, 'Mandant gesperrt')
    if (dbUser.forcedLogoutAt && dbUser.forcedLogoutAt.getTime() > u.loginAt) {
      throw new ApiError(401, 'Sitzung wird durch den Administrator beendet')
    }
  }

  // "zuletzt gesehen" gedrosselt aktualisieren
  const last = lastSeenCache.get(u.id) ?? 0
  if (Date.now() - last > SEEN_THROTTLE_MS) {
    lastSeenCache.set(u.id, Date.now())
    prisma.user
      .update({ where: { id: u.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined)
  }

  if (opts?.operator && !isOperator) throw new ApiError(403, 'Nur für den Betreiber')
  if (opts?.roles && !opts.roles.includes(u.role) && !isOperator) {
    throw new ApiError(403, 'Keine Berechtigung')
  }

  return {
    userId: u.id,
    email: u.email,
    role: u.role,
    tenantId: u.tenantId,
    tenantSlug: u.tenantSlug,
    tenantName: u.tenantName,
    impersonatorId: u.impersonatorId,
    impersonatorName: u.impersonatorName,
  }
}

/** Mandanten-Kontext erzwingen: liefert die Mandanten-ID oder wirft ab (Mandantentrennung an der Quelle, §22). */
export function requireTenant(ctx: Ctx): string {
  if (!ctx.tenantId) throw new ApiError(403, 'Kein Mandanten-Kontext')
  return ctx.tenantId
}
