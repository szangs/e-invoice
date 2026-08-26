// Mitarbeiter-Gruppen: umbenennen / löschen (nur Mandanten-Admin)
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

const schema = z.object({ name: z.string().min(1).max(80) })

async function findOwn(id: string, tenantId: string) {
  const group = await prisma.employeeGroup.findFirst({ where: { id, tenantId } })
  if (!group) throw new ApiError(404, 'Gruppe nicht gefunden')
  return group
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const existing = await findOwn(params.id, tenantId)
    const { name } = schema.parse(await req.json())
    const group = await prisma.employeeGroup.update({ where: { id: existing.id }, data: { name } })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'GROUP_UPDATE',
      details: `Gruppe "${existing.name}" umbenannt in "${name}"`,
    })
    return NextResponse.json({ group })
  } catch (e) {
    return jsonError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const existing = await findOwn(params.id, tenantId)
    await prisma.employeeGroup.delete({ where: { id: existing.id } })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'GROUP_DELETE',
      details: `Gruppe "${existing.name}" gelöscht`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
