// Mitarbeiter-Gruppen: Mitglieder hinzufügen / entfernen (nur Mandanten-Admin)
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

const schema = z.object({ userId: z.string().min(1) })

async function findOwnGroup(id: string, tenantId: string) {
  const group = await prisma.employeeGroup.findFirst({ where: { id, tenantId } })
  if (!group) throw new ApiError(404, 'Gruppe nicht gefunden')
  return group
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const group = await findOwnGroup(params.id, tenantId)
    const { userId } = schema.parse(await req.json())
    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw new ApiError(404, 'Mitarbeiter nicht gefunden')

    await prisma.employeeGroupMember.upsert({
      where: { groupId_userId: { groupId: group.id, userId } },
      update: {},
      create: { groupId: group.id, userId },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'GROUP_MEMBER_ADD',
      details: `${user.email} zu Gruppe "${group.name}" hinzugefügt`,
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
    const group = await findOwnGroup(params.id, tenantId)
    const { userId } = schema.parse(await req.json())
    const user = await prisma.user.findFirst({ where: { id: userId, tenantId } })
    if (!user) throw new ApiError(404, 'Mitarbeiter nicht gefunden')

    await prisma.employeeGroupMember.deleteMany({ where: { groupId: group.id, userId } })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'GROUP_MEMBER_REMOVE',
      details: `${user.email} aus Gruppe "${group.name}" entfernt`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
