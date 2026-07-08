// Verschlüsselungs-Konfiguration des Mandanten (Zero-Knowledge):
// Der Server speichert nur Salt + VERPACKTEN Datenschlüssel — nie die Passphrase,
// nie den entpackten Schlüssel. GET für alle Mandanten-Nutzer (zum Entsperren im
// Browser), POST/PUT nur für den Mandanten-Administrator.
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { hasFeature } from '@/lib/license'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { encryptionEnabled: true, encSalt: true, encWrappedDek: true, name: true },
    })
    return NextResponse.json({
      enabled: tenant?.encryptionEnabled ?? false,
      salt: tenant?.encSalt ?? null,
      wrappedDek: tenant?.encWrappedDek ?? null,
      // Nur fürs Zertifikat/Ausdruck (Stefan 2026-07-09, #102) — keine
      // sicherheitsrelevante Information.
      tenantName: tenant?.name ?? null,
    })
  } catch (e) {
    return jsonError(e)
  }
}

const setupSchema = z.object({ salt: z.string().min(8), wrappedDek: z.string().min(16) })

/** Einrichten (nur einmal möglich — Deaktivieren würde vorhandene Chiffrate unlesbar machen). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const data = setupSchema.parse(await req.json())
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new ApiError(404, 'Mandant nicht gefunden')
    if (tenant.encryptionEnabled) throw new ApiError(409, 'Verschlüsselung ist bereits eingerichtet.')
    if (!hasFeature(tenant, 'ENCRYPTION')) throw new ApiError(403, 'Beleg-Verschlüsselung ist im aktuellen Tarif nicht enthalten.')

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { encryptionEnabled: true, encSalt: data.salt, encWrappedDek: data.wrappedDek },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'ENCRYPTION_ENABLED',
      details: 'Ende-zu-Ende-Verschlüsselung der Belege aktiviert (Schlüssel nur beim Kunden)',
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}

/** Passphrase-Wechsel: Client entpackt den DEK mit alter Passphrase und liefert
 *  ihn NEU VERPACKT — die Dateien selbst müssen nicht umgeschlüsselt werden. */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const data = setupSchema.parse(await req.json())
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant?.encryptionEnabled) throw new ApiError(409, 'Verschlüsselung ist nicht eingerichtet.')

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { encSalt: data.salt, encWrappedDek: data.wrappedDek },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'ENCRYPTION_REKEY',
      details: 'Passphrase der Beleg-Verschlüsselung geändert',
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
