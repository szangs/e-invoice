// Plattformweite Benutzerverwaltung (Betreiber): alle Benutzer aller Mandanten
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'

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
