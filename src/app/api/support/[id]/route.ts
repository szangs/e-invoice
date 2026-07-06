// Fernwartung §14A — Statusübergänge: annehmen / ablehnen / beenden.
// Einwilligungsbasiert: Betreiber-Anfragen muss der Nutzer AKTIV annehmen.
import { NextRequest, NextResponse } from 'next/server'
import { Role, SupportStatus } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext } from '@/lib/context'
import { prisma } from '@/lib/db'

const schema = z.object({ action: z.enum(['accept', 'decline', 'end']) })

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const { action } = schema.parse(await req.json())
    const session = await prisma.supportSession.findUnique({ where: { id: params.id } })
    if (!session) throw new ApiError(404, 'Sitzung nicht gefunden')

    const isOperator = ctx.role === Role.OPERATOR_ADMIN && !ctx.tenantId
    const isOwnTenant = ctx.tenantId === session.tenantId
    if (!isOperator && !isOwnTenant) throw new ApiError(403, 'Keine Berechtigung')

    if (action === 'accept') {
      if (session.status !== SupportStatus.REQUESTED) throw new ApiError(409, 'Sitzung ist nicht offen.')
      // Betreiber nimmt Mandanten-Anfrage an — ODER Nutzer willigt in Betreiber-Anfrage ein
      if (isOperator && session.initiatedBy !== 'TENANT') throw new ApiError(409, 'Auf Einwilligung des Nutzers warten.')
      if (!isOperator && session.initiatedBy !== 'OPERATOR') throw new ApiError(409, 'Diese Anfrage nimmt der Betreiber an.')
      const updated = await prisma.supportSession.update({
        where: { id: session.id },
        data: {
          status: SupportStatus.ACTIVE,
          startedAt: new Date(),
          userId: isOperator ? session.userId : ctx.userId,
        },
      })
      await audit({
        tenantId: session.tenantId,
        actorId: ctx.userId,
        actorName: ctx.email,
        action: 'SUPPORT_STARTED',
        details: 'Fernwartungs-Sitzung aktiv (Einwilligung erteilt)',
      })
      return NextResponse.json({ session: updated })
    }

    if (action === 'decline') {
      if (session.status !== SupportStatus.REQUESTED) throw new ApiError(409, 'Sitzung ist nicht offen.')
      await prisma.supportSession.update({
        where: { id: session.id },
        data: { status: SupportStatus.DECLINED, endedAt: new Date(), endedBy: ctx.email },
      })
      await audit({
        tenantId: session.tenantId,
        actorId: ctx.userId,
        actorName: ctx.email,
        action: 'SUPPORT_DECLINED',
        details: 'Fernwartungs-Anfrage abgelehnt',
      })
      return NextResponse.json({ ok: true })
    }

    // end — jederzeit durch Nutzer ODER Betreiber (§14A)
    await prisma.supportSession.update({
      where: { id: session.id },
      data: { status: SupportStatus.ENDED, endedAt: new Date(), endedBy: ctx.email, snapshot: null },
    })
    await audit({
      tenantId: session.tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'SUPPORT_ENDED',
      details: 'Fernwartungs-Sitzung beendet',
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
