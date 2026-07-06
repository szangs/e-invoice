// Fernwartung §14A — Mandantenseite: Anfrage stellen / eigenen Status abrufen
import { NextResponse } from 'next/server'
import { SupportStatus } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** Aktuelle (offene oder letzte) Sitzung des Mandanten für die Support-Seite. */
export async function GET() {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const session = await prisma.supportSession.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ session })
  } catch (e) {
    return jsonError(e)
  }
}

/** Mandant fordert Unterstützung an (Einwilligung liegt damit vor, §14A). */
export async function POST() {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const open = await prisma.supportSession.findFirst({
      where: { tenantId, status: { in: [SupportStatus.REQUESTED, SupportStatus.ACTIVE] } },
    })
    if (open) return NextResponse.json({ session: open })
    const session = await prisma.supportSession.create({
      data: { tenantId, userId: ctx.userId, initiatedBy: 'TENANT' },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'SUPPORT_REQUESTED',
      details: 'Fernwartung (Bildschirmspiegelung) vom Mandanten angefordert',
    })
    return NextResponse.json({ session })
  } catch (e) {
    return jsonError(e)
  }
}
