// Plattformweite Benutzerverwaltung (Betreiber): alle Benutzer aller Mandanten
// + Betreiber-Konten selbst (Stefan 2026-08-27, Review-Fund "Systemverwaltung
// ohne Möglichkeit der Benutzeranlage" — vorher gab es hier nur GET/PATCH,
// kein POST: ein neues Betreiber-Konto ließ sich über die App gar nicht
// anlegen, nur direkt in der Datenbank).
import { NextRequest, NextResponse } from 'next/server'
import { Prisma, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { generatePassword, usernameBaseFromName } from '@/lib/password'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await getContext({ operator: true })
    const q = new URL(req.url).searchParams.get('q') ?? ''
    const where: Prisma.UserWhereInput = q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { username: { contains: q, mode: 'insensitive' } },
            { tenant: { name: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}
    const users = await prisma.user.findMany({
      where,
      include: { tenant: { select: { name: true, active: true } } },
      orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    })
    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        role: u.role,
        active: u.active,
        tenantName: u.tenant?.name ?? null,
        tenantActive: u.tenant?.active ?? true,
        lastLoginAt: u.lastLoginAt,
        lastSeenAt: u.lastSeenAt,
      })),
    })
  } catch (e) {
    return jsonError(e)
  }
}

const createSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1, 'Vorname fehlt').max(80),
  lastName: z.string().min(1, 'Nachname fehlt').max(80),
})

/** Wie generateUniqueUsername in api/admin/users/route.ts — username ist global @unique. */
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

/** Neues Betreiber-Konto anlegen (kein Mandant, Rolle immer OPERATOR_ADMIN —
 * anders als bei Mandanten-Nutzern gibt es hier keine Rollenauswahl). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ operator: true })
    const data = createSchema.parse(await req.json())
    const exists = await prisma.user.findFirst({ where: { tenantId: null, email: data.email.toLowerCase() } })
    if (exists) throw new ApiError(409, 'E-Mail ist bereits als Betreiber-Konto vergeben.')

    const password = generatePassword()
    const user = await prisma.user.create({
      data: {
        tenantId: null,
        email: data.email.toLowerCase(),
        username: await generateUniqueUsername(data.firstName, data.lastName),
        passwordHash: await bcrypt.hash(password, 10),
        firstName: data.firstName,
        lastName: data.lastName,
        role: Role.OPERATOR_ADMIN,
        active: true,
      },
    })
    await audit({
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'OPERATOR_USER_CREATE',
      details: `Betreiber-Konto ${data.firstName} ${data.lastName} <${user.email}> angelegt`,
    })
    return NextResponse.json({ credentials: { email: user.email, username: user.username, password } })
  } catch (e) {
    return jsonError(e)
  }
}
