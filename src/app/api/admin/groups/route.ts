// Mitarbeiter-Gruppen (Stefan 2026-08-26): Liste anzeigen / neue Gruppe
// anlegen — nur Mandanten-Admin. Siehe EmployeeGroup in schema.prisma.
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

const schema = z.object({ name: z.string().min(1).max(80) })

export async function GET() {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const groups = await prisma.employeeGroup.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: { members: { include: { user: { select: { id: true, email: true } } } } },
    })
    return NextResponse.json({
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        members: g.members.map((m) => ({ id: m.user.id, email: m.user.email })),
      })),
    })
  } catch (e) {
    return jsonError(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const { name } = schema.parse(await req.json())
    const exists = await prisma.employeeGroup.findUnique({ where: { tenantId_name: { tenantId, name } } })
    if (exists) throw new ApiError(409, 'Eine Gruppe mit diesem Namen gibt es schon.')
    const group = await prisma.employeeGroup.create({ data: { tenantId, name } })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'GROUP_CREATE',
      details: `Gruppe "${name}" angelegt`,
    })
    return NextResponse.json({ group: { id: group.id, name: group.name, members: [] } })
  } catch (e) {
    return jsonError(e)
  }
}
