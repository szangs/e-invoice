// Plattformweite Benutzer-Aktionen (Betreiber): aktiv/deaktiv, Passwort, Zwangsabmeldung, Rolle
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { generatePassword } from '@/lib/password'

const schema = z.object({
  active: z.boolean().optional(),
  resetPassword: z.boolean().optional(),
  forceLogout: z.boolean().optional(),
  role: z.enum(['TENANT_ADMIN', 'EDITOR', 'AREA_MANAGER', 'AUDITOR', 'USER']).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ operator: true })
    const data = schema.parse(await req.json())
    const user = await prisma.user.findUnique({ where: { id: params.id } })
    if (!user) throw new ApiError(404, 'Benutzer nicht gefunden')

    // Schutz: sich selbst und den letzten aktiven Betreiber nicht aussperren
    if (user.id === ctx.userId && (data.active === false || data.forceLogout)) {
      throw new ApiError(400, 'Das eigene Betreiber-Konto kann nicht gesperrt/abgemeldet werden.')
    }
    if (user.role === Role.OPERATOR_ADMIN && data.active === false) {
      const others = await prisma.user.count({
        where: { role: Role.OPERATOR_ADMIN, active: true, id: { not: user.id } },
      })
      if (others === 0) throw new ApiError(400, 'Der letzte aktive Betreiber-Administrator kann nicht deaktiviert werden.')
    }
    if (data.role && user.role === Role.OPERATOR_ADMIN) {
      throw new ApiError(400, 'Die Rolle des Betreiber-Administrators ist fix.')
    }

    let password: string | undefined
    const update: Record<string, unknown> = {}
    if (data.active !== undefined) {
      update.active = data.active
      if (!data.active) update.forcedLogoutAt = new Date()
    }
    if (data.forceLogout) update.forcedLogoutAt = new Date()
    if (data.role) update.role = data.role
    if (data.resetPassword) {
      password = generatePassword()
      update.passwordHash = await bcrypt.hash(password, 10)
      update.forcedLogoutAt = new Date()
    }
    await prisma.user.update({ where: { id: user.id }, data: update })

    const actions: string[] = []
    if (data.active !== undefined) actions.push(data.active ? 'aktiviert' : 'deaktiviert')
    if (data.forceLogout) actions.push('Zwangsabmeldung')
    if (data.role) actions.push(`Rolle → ${data.role}`)
    if (data.resetPassword) actions.push('Passwort zurückgesetzt')
    await audit({
      tenantId: user.tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'USER_UPDATE',
      details: `[Plattform] ${user.email}: ${actions.join(', ')}`,
    })
    return NextResponse.json(password ? { credentials: { email: user.email, password } } : { ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
