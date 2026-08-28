// Lieferanten-Adressregister anzeigen (Stefan 2026-08-26) — reine Lesezugriff
// für VendorAddressesPanel.tsx, die Pflege läuft automatisch, siehe
// lib/vendorMemory.ts upsertVendorAddress. POST (Stefan 2026-08-27): manuell
// einen Lieferanten für den SEPA-Export anlegen, der noch auf keiner
// Rechnung vorkam (siehe api/admin/vendor-addresses/[id] fürs Bearbeiten).
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { isValidBic, isValidIban } from '@/lib/sepa'

export async function GET() {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const addresses = await prisma.vendorAddress.findMany({ where: { tenantId }, orderBy: { vendorName: 'asc' } })
    return NextResponse.json({ addresses })
  } catch (e) {
    return jsonError(e)
  }
}

const createSchema = z.object({
  vendorName: z.string().min(1).max(200),
  iban: z.string().max(40).optional(),
  bic: z.string().max(20).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const { vendorName, iban, bic } = createSchema.parse(await req.json())
    const cleanIban = iban?.trim().toUpperCase().replace(/\s+/g, '') || null
    const cleanBic = bic?.trim().toUpperCase().replace(/\s+/g, '') || null
    if (cleanIban && !isValidIban(cleanIban)) throw new ApiError(400, 'IBAN ungültig (Prüfziffer stimmt nicht).')
    if (cleanBic && !isValidBic(cleanBic)) throw new ApiError(400, 'BIC ungültig.')

    const existing = await prisma.vendorAddress.findUnique({ where: { tenantId_vendorName: { tenantId, vendorName } } })
    if (existing) throw new ApiError(409, `"${vendorName}" existiert bereits — bitte den bestehenden Eintrag bearbeiten.`)

    const vendor = await prisma.vendorAddress.create({
      data: {
        tenantId,
        vendorName,
        iban: cleanIban,
        bic: cleanBic,
        ibanVerifiedAt: cleanIban ? new Date() : null,
        ibanVerifiedBy: cleanIban ? ctx.email : null,
      },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'VENDOR_ADDRESS_CREATE',
      details: `Lieferant "${vendorName}" manuell angelegt${cleanIban ? ' (mit Bankverbindung)' : ''}`,
    })
    return NextResponse.json({ ok: true, vendor })
  } catch (e) {
    return jsonError(e)
  }
}
