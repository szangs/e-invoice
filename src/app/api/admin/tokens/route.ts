// API-Token-Verwaltung (Mandanten-Administrator) für den Rechnungs-Catcher
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { generateToken, hashToken } from '@/lib/apiToken'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { hasFeature } from '@/lib/license'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const tokens = await prisma.apiToken.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, label: true, createdAt: true, lastUsedAt: true },
    })
    return NextResponse.json({ tokens })
  } catch (e) {
    return jsonError(e)
  }
}

const schema = z.object({ label: z.string().min(1).max(60) })

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant || !hasFeature(tenant, 'CATCHER')) {
      throw new ApiError(403, 'Der Rechnungs-Catcher ist im aktuellen Tarif nicht enthalten.')
    }
    const { label } = schema.parse(await req.json())
    const token = generateToken()
    await prisma.apiToken.create({ data: { tenantId, label, tokenHash: hashToken(token) } })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'TOKEN_CREATE',
      details: `API-Token "${label}" für Browser-Plugin erstellt`,
    })
    // Klartext-Token geht genau EINMAL an den Client — danach nur noch Hash in der DB
    return NextResponse.json({ token, label })
  } catch (e) {
    return jsonError(e)
  }
}
