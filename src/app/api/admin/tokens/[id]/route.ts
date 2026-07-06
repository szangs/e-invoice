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
    const token = await prisma.apiToken.findFirst({ where: { id: params.id, tenantId } })
    if (!token) throw new ApiError(404, 'Token nicht gefunden')
    await prisma.apiToken.delete({ where: { id: token.id } })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'TOKEN_DELETE',
      details: `API-Token "${token.label}" widerrufen`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
