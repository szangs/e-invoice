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
      if (!res.ok) {
        return NextResponse.json({
          ok: false,
          message: `Antwort ${res.status} nach ${ms} ms — bitte Schlüssel/URL prüfen.`,
        })
      }
      // Verfügbare Modell-IDs mitliefern — Modellnamen (v. a. für Vision) ändern
      // sich bei manchen Anbietern häufig, lieber direkt anzeigen statt raten.
      let models: string[] = []
      try {
        const body = await res.json()
        models = (body?.data ?? [])
          .map((m: { id?: string }) => m?.id)
          .filter((id: unknown): id is string => typeof id === 'string')
          .sort()
      } catch {
        /* Anbieter liefert kein Standard-/models-Format — Liste bleibt leer */
      }
      return NextResponse.json({
        ok: true,
        message: `Verbindung ok (${res.status}, ${ms} ms)${models.length ? ` — ${models.length} Modell(e) gefunden` : ''}`,
        models,
      })
    } catch {
      return NextResponse.json({ ok: false, message: 'Endpunkt nicht erreichbar (Timeout/Netzwerk).' })
    }
  } catch (e) {
    return jsonError(e)
  }
}
