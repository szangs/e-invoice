// Korb-Rechte je Gruppe (Stefan 2026-08-26) — Gegenstück zu rights/route.ts,
// gilt für alle Mitglieder der Gruppe statt für einen einzelnen Mitarbeiter.
// right = null löscht die Zeile (= kein Gruppen-Zugriff mehr auf diesen Korb).
import { NextRequest, NextResponse } from 'next/server'
import { BasketRight, Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { RIGHT_LABELS } from '@/lib/basketRights'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

const RIGHT_VALUES = ['VIEW', 'CONTENT', 'MOVE', 'APPROVE', 'HANDOVER', 'FIBU'] as const

const schema = z.object({
  groupId: z.string().min(1),
  right: z.enum(RIGHT_VALUES).nullable(),
})

async function findOwnBasket(id: string, tenantId: string) {
  const basket = await prisma.basket.findFirst({ where: { id, tenantId } })
  if (!basket) throw new ApiError(404, 'Korb nicht gefunden')
  return basket
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const basket = await findOwnBasket(params.id, tenantId)
    const { groupId, right } = schema.parse(await req.json())
    const group = await prisma.employeeGroup.findFirst({ where: { id: groupId, tenantId } })
    if (!group) throw new ApiError(404, 'Gruppe nicht gefunden')
    // Ablage (Stefan 2026-07-09): dieselbe Beschränkung wie bei Einzel-Rechten
    // (rights/route.ts) — Verschieben (und alles darüber) ist dort Admins vorbehalten.
    if (basket.kind === 'ARCHIVE' && right && right !== 'VIEW' && right !== 'CONTENT') {
      throw new ApiError(400, 'In der Ablage lässt sich nur "Korb sehen" oder "Inhalt anzeigen" vergeben — Verschieben ist Admins vorbehalten.')
    }

    if (right === null) {
      await prisma.basketGroupRight.deleteMany({ where: { basketId: basket.id, groupId } })
    } else {
      await prisma.basketGroupRight.upsert({
        where: { basketId_groupId: { basketId: basket.id, groupId } },
        update: { right: right as BasketRight },
        create: { basketId: basket.id, groupId, right: right as BasketRight },
      })
    }

    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'BASKET_GROUP_RIGHT_SET',
      details: `Korb "${basket.name}": Gruppe "${group.name}" → ${right ? RIGHT_LABELS[right as BasketRight] : 'kein Zugriff'}`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
