// Benutzerverwaltung je Mandant (§8) — nur Mandanten-Administrator, nur eigener Mandant.
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { generatePassword, generateUsername } from '@/lib/password'

const TENANT_ROLES = [Role.TENANT_ADMIN, Role.EDITOR, Role.AREA_MANAGER, Role.AUDITOR, Role.USER] as const

const schema = z.object({
  email: z.string().email(),
  role: z.enum(['TENANT_ADMIN', 'EDITOR', 'AREA_MANAGER', 'AUDITOR', 'USER']),
})

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const data = schema.parse(await req.json())

    // Benutzer-Obergrenze des Mandanten (§8)
    const [tenant, count] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId } }),
      prisma.user.count({ where: { tenantId } }),
    ])
    if (!tenant) throw new ApiError(404, 'Mandant nicht gefunden')
    if (count >= tenant.maxUsers) {
      throw new ApiError(409, `Benutzer-Obergrenze erreicht (${tenant.maxUsers}).`)
    }
    const exists = await prisma.user.findFirst({
      where: { tenantId, email: data.email.toLowerCase() },
    })
    if (exists) throw new ApiError(409, 'E-Mail ist in diesem Mandanten bereits vergeben.')

    const password = generatePassword()
    const user = await prisma.user.create({
      data: {
        tenantId,
        email: data.email.toLowerCase(),
        username: generateUsername(ctx.tenantSlug ?? 'user'),
        passwordHash: await bcrypt.hash(password, 10),
        role: TENANT_ROLES.find((r) => r === data.role) ?? Role.USER,
        active: true,
      },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'USER_CREATE',
      details: `Benutzer ${user.email} (${user.role}) angelegt`,
    })
    return NextResponse.json({ credentials: { email: user.email, password } })
  } catch (e) {
    return jsonError(e)
  }
}
