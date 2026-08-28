// Bankverbindung eines Lieferanten bearbeiten/bestätigen (Stefan 2026-08-27,
// SEPA-Sammelüberweisung) — anders als die Anschrift (rein automatisch aus
// Rechnungen gepflegt, siehe lib/vendorMemory.ts) lässt sich IBAN/BIC hier
// manuell setzen/korrigieren. Jedes Speichern hier gilt als menschliche
// Bestätigung (ibanVerifiedAt/-By wird gesetzt) — erst dann ist die
// Kontoverbindung für den SEPA-Export nutzbar (siehe api/invoices/export/sepa).
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { isValidBic, isValidIban } from '@/lib/sepa'

const schema = z.object({
  iban: z.string().max(40).optional(),
  bic: z.string().max(20).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const { iban, bic } = schema.parse(await req.json())
    const existing = await prisma.vendorAddress.findFirst({ where: { id: params.id, tenantId } })
    if (!existing) throw new ApiError(404, 'Lieferant nicht gefunden.')

    const cleanIban = iban?.trim().toUpperCase().replace(/\s+/g, '') || null
    const cleanBic = bic?.trim().toUpperCase().replace(/\s+/g, '') || null
    if (cleanIban && !isValidIban(cleanIban)) throw new ApiError(400, 'IBAN ungültig (Prüfziffer stimmt nicht).')
    if (cleanBic && !isValidBic(cleanBic)) throw new ApiError(400, 'BIC ungültig.')

    const vendor = await prisma.vendorAddress.update({
      where: { id: existing.id },
      data: {
        iban: cleanIban,
        bic: cleanBic,
        // Speichern gilt als Bestätigung — auch wenn der Wert unverändert
        // aus der automatischen Erkennung übernommen wird (siehe Datei-Kopf).
        ibanVerifiedAt: cleanIban ? new Date() : null,
        ibanVerifiedBy: cleanIban ? ctx.email : null,
      },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'VENDOR_IBAN_SET',
      details: `Bankverbindung für "${existing.vendorName}" ${cleanIban ? 'bestätigt/gesetzt' : 'entfernt'}`,
    })
    return NextResponse.json({ ok: true, vendor })
  } catch (e) {
    return jsonError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const existing = await prisma.vendorAddress.findFirst({ where: { id: params.id, tenantId } })
    if (!existing) throw new ApiError(404, 'Lieferant nicht gefunden.')
    await prisma.vendorAddress.delete({ where: { id: existing.id } })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'VENDOR_ADDRESS_DELETE',
      details: `Lieferanten-Eintrag "${existing.vendorName}" gelöscht`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
