// Rollen-Rechte-Matrix je Mandant (Stefan 2026-08-27, siehe lib/roleActions.ts)
// — nur Mandanten-Admin (bzw. Betreiber) darf sie ändern, dieselbe Regel wie
// bei den Korb-Rechten (admin/baskets/[id]/rights).
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { CONFIGURABLE_ROLES, ROLE_ACTIONS, ROLE_ACTION_LABELS, ROLE_LABELS, withRoleActionOverride } from '@/lib/roleActions'

const schema = z.object({
  role: z.enum(['EDITOR', 'AREA_MANAGER', 'AUDITOR', 'USER']),
  action: z.enum(ROLE_ACTIONS),
  enabled: z.boolean(),
})

export async function PUT(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const { role, action, enabled } = schema.parse(await req.json())
    if (!CONFIGURABLE_ROLES.includes(role)) {
      throw new ApiError(400, 'Diese Rolle hat ohnehin immer alle Aktionen.')
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { roleActions: true } })
    if (!tenant) throw new ApiError(404, 'Mandant nicht gefunden')
    const nextOverrides = withRoleActionOverride(tenant.roleActions, role, action, enabled)
    await prisma.tenant.update({ where: { id: tenantId }, data: { roleActions: nextOverrides } })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'ROLE_ACTION_SET',
      details: `Rolle "${ROLE_LABELS[role]}": ${ROLE_ACTION_LABELS[action]} → ${enabled ? 'erlaubt' : 'gesperrt'}`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
