// Körbe: Mitarbeiter zuordnen / entfernen (nur Mandanten-Admin)
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

const schema = z.object({ userId: z.string().min(1) })

async function findOwnBasket(id: string, tenantId: string) {
  const basket = await prisma.basket.findFirst({ where: { id, tenantId } })
  if (!basket) throw new ApiError(404, 'Korb nicht gefunden')
  return basket
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const basket = await findOwnBasket(params.id, tenantId)
    const { userId } = schema.parse(await req.json())
    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw new ApiError(404, 'Mitarbeiter nicht gefunden')

    await prisma.basketMember.upsert({
      where: { basketId_userId: { basketId: basket.id, userId } },
      update: {},
      create: { basketId: basket.id, userId },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'BASKET_MEMBER_ADD',
      details: `${user.email} zu Korb "${basket.name}" hinzugefügt`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const basket = await findOwnBasket(params.id, tenantId)
    const { userId } = schema.parse(await req.json())
    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw new ApiError(404, 'Mitarbeiter nicht gefunden')

    await prisma.basketMember.deleteMany({ where: { basketId: basket.id, userId } })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'BASKET_MEMBER_REMOVE',
      details: `${user.email} aus Korb "${basket.name}" entfernt`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
