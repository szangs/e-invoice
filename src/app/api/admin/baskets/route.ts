// Körbe: Liste (für alle angemeldeten Mitarbeiter — Filter/Verschieben) und
// Anlage neuer Körbe (nur Mandanten-Admin).
import { NextRequest, NextResponse } from 'next/server'
import { BasketKind, Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ensureSystemBaskets } from '@/lib/baskets'
import { getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    await ensureSystemBaskets(tenantId)
    const baskets = await prisma.basket.findMany({
      where: { tenantId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: {
        members: { include: { user: { select: { id: true, email: true, username: true } } } },
        _count: { select: { invoices: { where: { deletedAt: null } } } },
      },
    })
    return NextResponse.json({ baskets })
  } catch (e) {
    return jsonError(e)
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
})

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const { name } = createSchema.parse(await req.json())
    const maxPos = await prisma.basket.aggregate({ where: { tenantId }, _max: { position: true } })
    const basket = await prisma.basket.create({
      data: {
        tenantId,
        name,
        kind: BasketKind.CUSTOM,
        position: (maxPos._max.position ?? 0) + 1,
      },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'BASKET_CREATE',
      details: `Korb "${basket.name}" angelegt`,
    })
    return NextResponse.json({ basket })
  } catch (e) {
    return jsonError(e)
  }
}
