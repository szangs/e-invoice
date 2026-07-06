// Benutzer bearbeiten (§8): Rolle, aktiv/deaktiv, Passwort zurücksetzen — nur eigener Mandant.
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { generatePassword } from '@/lib/password'

const schema = z.object({
  role: z.enum(['TENANT_ADMIN', 'EDITOR', 'AREA_MANAGER', 'AUDITOR', 'USER']).optional(),
  active: z.boolean().optional(),
  resetPassword: z.boolean().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const data = schema.parse(await req.json())

    // Mandantentrennung an der Quelle (§22): Benutzer muss zum eigenen Mandanten gehören
    const user = await prisma.user.findFirst({ where: { id: params.id, tenantId } })
    if (!user) throw new ApiError(404, 'Benutzer nicht gefunden')
    if (user.id === ctx.userId && data.active === false) {
      throw new ApiError(400, 'Das eigene Konto kann nicht deaktiviert werden.')
    }

    let password: string | undefined
    const update: Record<string, unknown> = {}
    if (data.role) update.role = data.role
    if (data.active !== undefined) {
      update.active = data.active
      if (!data.active) update.forcedLogoutAt = new Date()
    }
    if (data.resetPassword) {
      password = generatePassword()
      update.passwordHash = await bcrypt.hash(password, 10)
      update.forcedLogoutAt = new Date()
    }
    await prisma.user.update({ where: { id: user.id }, data: update })

    const actions: string[] = []
    if (data.role) actions.push(`Rolle → ${data.role}`)
    if (data.active !== undefined) actions.push(data.active ? 'aktiviert' : 'deaktiviert')
    if (data.resetPassword) actions.push('Passwort zurückgesetzt')
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'USER_UPDATE',
      details: `${user.email}: ${actions.join(', ')}`,
    })
    return NextResponse.json(password ? { credentials: { email: user.email, password } } : { ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
