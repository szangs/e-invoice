// Körbe: Umbenennen / Vier-Augen- und Benachrichtigungs-Einstellungen ändern
// / löschen — Eingangs- und Übergabekorb sind fest (kein Löschen, kein
// Vier-Augen-Prinzip, da sonst niemand mehr eine Rechnung anlegen bzw.
// übergeben könnte).
import { NextRequest, NextResponse } from 'next/server'
import { BasketKind, Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

const schema = z.object({
  name: z.string().min(1).max(120).optional(),
  fourEyesEnabled: z.boolean().optional(),
  notificationEnabled: z.boolean().optional(),
  notificationIntervalHours: z.number().int().min(1).max(24 * 30).nullable().optional(),
  position: z.number().int().optional(),
  // Wiederherstellen eines weich gelöschten (leeren) Korbs (siehe DELETE-Handler)
  restore: z.literal(true).optional(),
})

async function findOwn(id: string, tenantId: string) {
  const basket = await prisma.basket.findFirst({ where: { id, tenantId } })
  if (!basket) throw new ApiError(404, 'Korb nicht gefunden')
  return basket
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const existing = await findOwn(params.id, tenantId)
    const { restore, ...data } = schema.parse(await req.json())

    if (existing.deletedAt && !restore) {
      throw new ApiError(409, 'Korb ist gelöscht — bitte zuerst wiederherstellen.')
    }
    if (existing.kind !== BasketKind.CUSTOM && data.fourEyesEnabled) {
      throw new ApiError(400, 'Eingangs- und Übergabekorb können kein Vier-Augen-Prinzip verwenden')
    }
    if (data.notificationEnabled && !data.notificationIntervalHours && !existing.notificationIntervalHours) {
      throw new ApiError(400, 'Bitte ein Intervall in Stunden angeben')
    }

    const basket = await prisma.basket.update({
      where: { id: existing.id },
      data: { ...data, ...(restore ? { deletedAt: null, deletedBy: null } : {}) },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: restore ? 'BASKET_RESTORE' : 'BASKET_UPDATE',
      details: restore
        ? `Korb "${existing.name}" wiederhergestellt`
        : `Korb "${existing.name}" geändert: ${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    })
    return NextResponse.json({ basket })
  } catch (e) {
    return jsonError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const existing = await findOwn(params.id, tenantId)
    if (existing.kind !== BasketKind.CUSTOM) {
      throw new ApiError(400, 'Eingangs- und Übergabekorb können nicht gelöscht werden')
    }
    if (existing.deletedAt) {
      throw new ApiError(409, 'Korb ist bereits gelöscht.')
    }
    const invoiceCount = await prisma.invoice.count({ where: { basketId: existing.id, deletedAt: null } })
    if (invoiceCount > 0) {
      throw new ApiError(409, `Korb enthält noch ${invoiceCount} Rechnung(en) — bitte zuerst verschieben`)
    }
    // Weiches Löschen (Stefan 2026-07-08) — nur leere Körbe (siehe Prüfung
    // oben), landet im Papierkorb für Körbe und lässt sich wiederherstellen.
    await prisma.basket.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), deletedBy: ctx.email },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'BASKET_DELETE',
      details: `Korb "${existing.name}" gelöscht (weich, wiederherstellbar)`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
