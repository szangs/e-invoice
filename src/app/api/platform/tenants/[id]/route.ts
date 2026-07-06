// Mandant bearbeiten / sperren / entsperren (§7) — nur Betreiber
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'

const schema = z.object({
  name: z.string().min(2).optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactName: z.string().optional(),
  street: z.string().optional(),
  zip: z.string().optional(),
  city: z.string().optional(),
  employeeCount: z.coerce.number().int().min(0).optional(),
  maxUsers: z.coerce.number().int().min(1).optional(),
  licensePlan: z.string().optional(),
  licenseSerial: z.string().optional(),
  licenseExpiresAt: z.string().nullable().optional(),
  active: z.boolean().optional(),
  aiAllowed: z.boolean().optional(),
  ipLoggingAllowed: z.boolean().optional(),
  defaultLanguage: z.string().optional(),
  backupEnabled: z.boolean().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ operator: true })
    const data = schema.parse(await req.json())
    const before = await prisma.tenant.findUnique({ where: { id: params.id } })
    if (!before) return NextResponse.json({ error: 'Mandant nicht gefunden.' }, { status: 404 })

    const tenant = await prisma.tenant.update({
      where: { id: params.id },
      data: {
        ...data,
        contactEmail: data.contactEmail === '' ? null : data.contactEmail,
        licenseExpiresAt:
          data.licenseExpiresAt === undefined
            ? undefined
            : data.licenseExpiresAt
              ? new Date(data.licenseExpiresAt)
              : null,
      },
    })

    if (data.active !== undefined && data.active !== before.active) {
      await audit({
        tenantId: tenant.id,
        actorId: ctx.userId,
        actorName: ctx.email,
        action: data.active ? 'TENANT_UNLOCK' : 'TENANT_LOCK',
        details: `Mandant "${tenant.name}" ${data.active ? 'entsperrt' : 'gesperrt'}`,
      })
    } else {
      await audit({
        tenantId: tenant.id,
        actorId: ctx.userId,
        actorName: ctx.email,
        action: 'TENANT_UPDATE',
        details: `Mandant "${tenant.name}" bearbeitet`,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
