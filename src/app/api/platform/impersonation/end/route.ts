// Beenden der Identitätsübernahme (§12): zurück in den Plattform-Bereich ohne erneute Anmeldung.
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext } from '@/lib/context'
import { prisma } from '@/lib/db'

export async function POST() {
  try {
    const ctx = await getContext()
    if (!ctx.impersonatorId) throw new ApiError(400, 'Keine laufende Identitätsübernahme')

    await audit({
      tenantId: ctx.tenantId,
      actorId: ctx.impersonatorId,
      actorName: ctx.impersonatorName ?? 'Betreiber',
      action: 'IMPERSONATE_END',
      details: `Übernahme als ${ctx.email} beendet`,
    })
    const ticket = await prisma.loginTicket.create({
      data: {
        code: randomBytes(24).toString('hex'),
        targetUserId: ctx.impersonatorId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    return NextResponse.json({ ticket: ticket.code })
  } catch (e) {
    return jsonError(e)
  }
}
