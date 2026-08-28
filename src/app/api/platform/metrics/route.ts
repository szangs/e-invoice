// System-Metriken fürs Betreiber-Cockpit (Stefan 2026-08-27) — liefert die
// aktuelle Momentaufnahme + den Prozess-Verlauf (siehe lib/metrics.ts). Wird
// vom MetricsPanel regelmäßig abgefragt (Polling statt Server-Sent Events —
// die paar Betreiber-Zugriffe rechtfertigen keine offene Verbindung).
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { getContext } from '@/lib/context'
import { getMetrics } from '@/lib/metrics'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await getContext({ operator: true })
    const { current, history, aiTokenHistory } = await getMetrics()
    return NextResponse.json({ current, history, aiTokenHistory })
  } catch (e) {
    return jsonError(e)
  }
}
