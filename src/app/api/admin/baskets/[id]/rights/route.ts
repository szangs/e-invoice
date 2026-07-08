// Korb-Rechte je Mitarbeiter (Stefan 2026-07-08, umgestellt von Rolle auf
// direkte Mitarbeiter-Auswahl) — nur Mandanten-Admin (bzw. Betreiber, der
// ohnehin immer alle Rechte hat) darf diese Zuordnung ändern.
// right = null löscht die Zeile (= kein Zugriff für diesen Mitarbeiter auf diesen Korb).
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
  userId: z.string().min(1),
  right: z.enum(RIGHT_VALUES).nullable(),
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
    const { userId, right } = schema.parse(await req.json())
    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw new ApiError(404, 'Mitarbeiter nicht gefunden')
    if (user.role === Role.TENANT_ADMIN || user.role === Role.OPERATOR_ADMIN) {
      throw new ApiError(400, 'Mandanten-Admins haben ohnehin immer alle Rechte auf jeden Korb.')
    }
    // Ablage (Stefan 2026-07-09): fester Systemordner nach der Übergabe —
    // Verschieben (und alles darüber) darf dort NIEMAND außer Admin/Betreiber
    // bekommen, sonst könnte jemand Belege eigenmächtig wieder herausnehmen.
    if (basket.kind === 'ARCHIVE' && right && right !== 'VIEW' && right !== 'CONTENT') {
      throw new ApiError(400, 'In der Ablage lässt sich nur "Korb sehen" oder "Inhalt anzeigen" vergeben — Verschieben ist Admins vorbehalten.')
    }

    if (right === null) {
      await prisma.basketUserRight.deleteMany({ where: { basketId: basket.id, userId } })
    } else {
      await prisma.basketUserRight.upsert({
        where: { basketId_userId: { basketId: basket.id, userId } },
        update: { right: right as BasketRight },
        create: { basketId: basket.id, userId, right: right as BasketRight },
      })
    }

    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'BASKET_RIGHT_SET',
      details: `Korb "${basket.name}": ${user.email} → ${right ? RIGHT_LABELS[right as BasketRight] : 'kein Zugriff'}`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
