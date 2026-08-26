// Belegfluss je Korb (Stefan 2026-08-25): erlaubte Ziel-Körbe für das
// Verschieben AUS diesem Korb — ersetzt bei jedem PUT die komplette Menge
// (einfacher für eine Checkbox-Liste als Einzel-Toggles). Solange für einen
// Korb NICHTS eingetragen ist, bleibt das Verschieben uneingeschränkt (siehe
// lib/baskets.ts requestMove) — nur Mandanten-Admin/Betreiber dürfen ändern.
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

const schema = z.object({
  targetBasketIds: z.array(z.string()),
})

async function findOwn(id: string, tenantId: string) {
  const basket = await prisma.basket.findFirst({ where: { id, tenantId } })
  if (!basket) throw new ApiError(404, 'Korb nicht gefunden')
  return basket
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const basket = await findOwn(params.id, tenantId)
    const { targetBasketIds } = schema.parse(await req.json())

    // Nur Ziele akzeptieren, die tatsächlich existierende, eigene, nicht
    // gelöschte Körbe sind (Mandantentrennung + kein Verweis auf sich selbst).
    const validTargets = await prisma.basket.findMany({
      where: { id: { in: targetBasketIds.filter((id) => id !== basket.id) }, tenantId, deletedAt: null },
      select: { id: true, name: true },
    })
    const validIds = validTargets.map((t) => t.id)

    await prisma.$transaction([
      prisma.basketTransition.deleteMany({ where: { fromBasketId: basket.id } }),
      ...(validIds.length > 0
        ? [
            prisma.basketTransition.createMany({
              data: validIds.map((toBasketId) => ({ tenantId, fromBasketId: basket.id, toBasketId })),
            }),
          ]
        : []),
    ])

    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'BASKET_TRANSITIONS_SET',
      details: `Korb "${basket.name}": Belegfluss-Ziele = ${validTargets.length > 0 ? validTargets.map((t) => t.name).join(', ') : '(uneingeschränkt)'}`,
    })
    return NextResponse.json({ ok: true, targetBasketIds: validIds })
  } catch (e) {
    return jsonError(e)
  }
}
