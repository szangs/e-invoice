// Mandantenspezifische Schalter durch den lokalen Administrator (§8)
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

const schema = z.object({
  aiAllowed: z.boolean().optional(),
  ipLoggingAllowed: z.boolean().optional(),
  defaultLanguage: z.string().optional(),
  backupEnabled: z.boolean().optional(),
})

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const data = schema.parse(await req.json())
    await prisma.tenant.update({ where: { id: tenantId }, data })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'TENANT_SWITCHES',
      details: `Schalter geändert: ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
