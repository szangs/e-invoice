// Betriebssteuerung (§9): Wartungs-/Anmeldesperre + Service-Status-Text — wirkt sofort.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getContext } from '@/lib/context'
import { setSetting } from '@/lib/settings'

const schema = z.object({
  maintenanceLock: z.boolean().optional(),
  serviceStatusText: z.string().max(200).optional(),
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
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
