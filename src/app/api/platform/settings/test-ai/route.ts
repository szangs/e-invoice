// Verbindungs-Test für den frei konfigurierbaren KI-Anbieter (§24)
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { getContext } from '@/lib/context'
import { getSettings } from '@/lib/settings'

export async function POST() {
  try {
    await getContext({ operator: true })
    const s = await getSettings()
    if (!s.AI_BASE_URL) {
      return NextResponse.json({ ok: false, message: 'Keine Endpunkt-/Basis-URL konfiguriert.' })
    }
    const url = s.AI_BASE_URL.replace(/\/$/, '') + '/models'
    const started = Date.now()
    try {
      const res = await fetch(url, {
        headers: s.AI_API_KEY ? { Authorization: `Bearer ${s.AI_API_KEY}` } : {},
        signal: AbortSignal.timeout(8000),
      })
      const ms = Date.now() - started
      return NextResponse.json({
        ok: res.ok,
        message: res.ok
          ? `Verbindung ok (${res.status}, ${ms} ms)`
          : `Antwort ${res.status} nach ${ms} ms — bitte Schlüssel/URL prüfen.`,
      })
    } catch {
      return NextResponse.json({ ok: false, message: 'Endpunkt nicht erreichbar (Timeout/Netzwerk).' })
    }
  } catch (e) {
    return jsonError(e)
  }
}
