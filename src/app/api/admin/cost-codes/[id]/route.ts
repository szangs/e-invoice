import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const row = await prisma.costCode.findFirst({ where: { id: params.id, tenantId } })
    if (!row) throw new ApiError(404, 'Eintrag nicht gefunden.')
    await prisma.costCode.delete({ where: { id: row.id } })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'COST_CODES_IMPORT',
      details: `${row.kind === 'KOSTENSTELLE' ? 'Kostenstelle' : 'Kostenträger'} "${row.code} — ${row.name}" gelöscht`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
