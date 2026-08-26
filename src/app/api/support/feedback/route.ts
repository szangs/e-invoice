// Allgemeines Nutzer-Feedback (§26) — globaler Feedback-Button in der
// App-Leiste (Stefan 2026-08-25). Kein eigener Datensatz nötig — geht wie
// beim "Schnittstelle vermissen"-Formular (api/support/interface-request)
// direkt per Mail an den festen Support-Kontakt.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { ApiError, getContext } from '@/lib/context'
import { APP_VERSION } from '@/lib/config'
import { sendSystemMail } from '@/lib/mail'
import { getSetting } from '@/lib/settings'

const SUPPORT_EMAIL = 'stefan.zangs@deltaplus.de'

const schema = z.object({
  message: z.string().min(1).max(2000),
  page: z.string().max(200).optional(),
  // Fehlermeldung (Stefan 2026-08-25) — eigenes Feld statt nur im Fließtext,
  // damit sie beim Support klar als solche erkennbar bleibt (z. B. eine
  // wörtlich hineinkopierte Fehlermeldung aus der Oberfläche).
  errorMessage: z.string().max(2000).optional(),
  // Technischer Kontext (Stefan 2026-08-25) — IMMER automatisch mitgeschickt,
  // ohne dass der Nutzer daran denken muss: hilft beim Nachvollziehen
  // deutlich mehr als "geht bei mir nicht" allein.
  userAgent: z.string().max(300).optional(),
  viewport: z.string().max(30).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext()
    if ((await getSetting('FEEDBACK_ENABLED')) !== '1') {
      throw new ApiError(403, 'Feedback ist aktuell deaktiviert (Systemeinstellungen).')
    }
    const { message, page, errorMessage, userAgent, viewport } = schema.parse(await req.json())

    const lines = [
      `Mandant: ${ctx.tenantName ?? '—'}`,
      `Von: ${ctx.email} (${ctx.role})`,
      `Zeitpunkt: ${new Date().toLocaleString('de-DE')}`,
      `App-Version: ${APP_VERSION}`,
      ...(page ? [`Seite: ${page}`] : []),
      ...(viewport ? [`Fenstergröße: ${viewport}`] : []),
      ...(userAgent ? [`Browser: ${userAgent}`] : []),
      '',
      ...(errorMessage ? [`Fehlermeldung:\n${errorMessage}`, ''] : []),
      message,
    ]
    const result = await sendSystemMail(
      SUPPORT_EMAIL,
      `Nutzer-Feedback von ${ctx.tenantName ?? ctx.email}${errorMessage ? ' (mit Fehlermeldung)' : ''}`,
      lines.join('\n'),
    )
    if (!result.sent) {
      return NextResponse.json({ error: result.reason ?? 'Versand fehlgeschlagen' }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
