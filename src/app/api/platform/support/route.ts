// Fernwartung §14A — Betreiberseite: offene/aktive Sitzungen listen, Anfrage initiieren.
import { NextRequest, NextResponse } from 'next/server'
import { SupportStatus } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await getContext({ operator: true })
    const sessions = await prisma.supportSession.findMany({
      where: { status: { in: [SupportStatus.REQUESTED, SupportStatus.ACTIVE] } },
      orderBy: { createdAt: 'desc' },
    })
    const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } })
    const names = Object.fromEntries(tenants.map((t) => [t.id, t.name]))
    return NextResponse.json({
      sessions: sessions.map((s) => ({ ...s, tenantName: names[s.tenantId] ?? s.tenantId })),
    })
  } catch (e) {
    return jsonError(e)
  }
}

const schema = z.object({ tenantId: z.string().min(1) })

/** Betreiber initiiert — der Nutzer muss aktiv einwilligen (§14A). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ operator: true })
    const { tenantId } = schema.parse(await req.json())
    const open = await prisma.supportSession.findFirst({
      where: { tenantId, status: { in: [SupportStatus.REQUESTED, SupportStatus.ACTIVE] } },
    })
    if (open) return NextResponse.json({ session: open })
    const session = await prisma.supportSession.create({
      data: { tenantId, initiatedBy: 'OPERATOR' },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'SUPPORT_REQUESTED',
      details: 'Fernwartung vom Betreiber angefragt — wartet auf Einwilligung des Nutzers',
    })
    return NextResponse.json({ session })
  } catch (e) {
    return jsonError(e)
  }
}
