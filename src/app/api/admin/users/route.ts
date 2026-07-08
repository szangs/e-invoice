// Benutzerverwaltung je Mandant (§8) — nur Mandanten-Administrator, nur eigener Mandant.
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { generatePassword, usernameBaseFromName } from '@/lib/password'

const TENANT_ROLES = [Role.TENANT_ADMIN, Role.EDITOR, Role.AREA_MANAGER, Role.AUDITOR, Role.USER] as const

const schema = z.object({
  email: z.string().email(),
  role: z.enum(['TENANT_ADMIN', 'EDITOR', 'AREA_MANAGER', 'AUDITOR', 'USER']),
  firstName: z.string().min(1, 'Vorname fehlt').max(80),
  lastName: z.string().min(1, 'Nachname fehlt').max(80),
  department: z.string().max(120).optional(),
  jobTitle: z.string().max(120).optional(),
})

/** Benutzername aus Vor-/Nachname, bei Kollision mit Zähler eindeutig gemacht (username ist global @unique). */
async function generateUniqueUsername(firstName: string, lastName: string): Promise<string> {
  const base = usernameBaseFromName(firstName, lastName)
  let candidate = base
  let n = 1
  // eslint-disable-next-line no-await-in-loop
  while (await prisma.user.findUnique({ where: { username: candidate } })) {
    n++
    candidate = `${base}${n}`
  }
  return candidate
}

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
        username: await generateUniqueUsername(data.firstName, data.lastName),
        passwordHash: await bcrypt.hash(password, 10),
        firstName: data.firstName,
        lastName: data.lastName,
        department: data.department || null,
        jobTitle: data.jobTitle || null,
        role: TENANT_ROLES.find((r) => r === data.role) ?? Role.USER,
        active: true,
      },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'USER_CREATE',
      details: `Benutzer ${data.firstName} ${data.lastName} <${user.email}> (${user.role}) angelegt`,
    })
    return NextResponse.json({ credentials: { email: user.email, username: user.username, password } })
  } catch (e) {
    return jsonError(e)
  }
}
