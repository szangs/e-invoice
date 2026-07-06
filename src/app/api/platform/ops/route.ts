// Betriebssteuerung (§9): Wartungssperre, Status-Text, Support-Zeitabschluss,
// Not-Aus für alle Fernwartungs-Sitzungen — wirkt sofort.
import { NextRequest, NextResponse } from 'next/server'
import { SupportStatus } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { setSetting } from '@/lib/settings'

const schema = z.object({
  maintenanceLock: z.boolean().optional(),
  serviceStatusText: z.string().max(200).optional(),
  supportTimeoutMin: z.string().regex(/^\d+$/).optional(),
  endAllSupport: z.boolean().optional(),
})

export async function PUT(req: NextRequest) {
  try {
    const ctx = await getContext({ operator: true })
    const data = schema.parse(await req.json())
    if (data.maintenanceLock !== undefined) {
      await setSetting('MAINTENANCE_LOCK', data.maintenanceLock ? '1' : '')
      await audit({
        actorId: ctx.userId,
        actorName: ctx.email,
        action: data.maintenanceLock ? 'MAINTENANCE_ON' : 'MAINTENANCE_OFF',
        details: 'Wartungs-/Anmeldesperre umgeschaltet',
      })
    }
    if (data.serviceStatusText !== undefined) {
      await setSetting('SERVICE_STATUS_TEXT', data.serviceStatusText)
      await audit({
        actorId: ctx.userId,
        actorName: ctx.email,
        action: 'SERVICE_STATUS_TEXT',
        details: data.serviceStatusText ? `Text gesetzt: "${data.serviceStatusText}"` : 'Text entfernt',
      })
    }
    if (data.supportTimeoutMin !== undefined) {
      await setSetting('SUPPORT_TIMEOUT_MIN', data.supportTimeoutMin)
      await audit({
        actorId: ctx.userId,
        actorName: ctx.email,
        action: 'SUPPORT_TIMEOUT',
        details: `Globaler Support-Zeitabschluss: ${data.supportTimeoutMin} min`,
      })
    }
    if (data.endAllSupport) {
      const result = await prisma.supportSession.updateMany({
        where: { status: { in: [SupportStatus.ACTIVE, SupportStatus.REQUESTED] } },
        data: { status: SupportStatus.ENDED, endedAt: new Date(), endedBy: ctx.email, snapshot: null },
      })
      await audit({
        actorId: ctx.userId,
        actorName: ctx.email,
        action: 'SUPPORT_KILLALL',
        details: `Not-Aus: ${result.count} Fernwartungs-Sitzung(en) beendet`,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
