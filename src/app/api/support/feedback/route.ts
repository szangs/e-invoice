// Allgemeines Nutzer-Feedback (§26) — globaler Feedback-Button in der
// App-Leiste (Stefan 2026-08-25). Kein eigener Datensatz nötig — geht wie
// beim "Schnittstelle vermissen"-Formular (api/support/interface-request)
// direkt per Mail an den festen Support-Kontakt.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { ApiError, getContext } from '@/lib/context'
import { sendSystemMail } from '@/lib/mail'
import { getSetting } from '@/lib/settings'

const SUPPORT_EMAIL = 'stefan.zangs@deltaplus.de'

const schema = z.object({
  message: z.string().min(1).max(2000),
  page: z.string().max(200).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext()
    if ((await getSetting('FEEDBACK_ENABLED')) !== '1') {
      throw new ApiError(403, 'Feedback ist aktuell deaktiviert (Systemeinstellungen).')
    }
    const { message, page } = schema.parse(await req.json())

    const lines = [
      `Mandant: ${ctx.tenantName ?? '—'}`,
      `Von: ${ctx.email}`,
      ...(page ? [`Seite: ${page}`] : []),
      '',
      message,
    ]
    const result = await sendSystemMail(
      SUPPORT_EMAIL,
      `Nutzer-Feedback von ${ctx.tenantName ?? ctx.email}`,
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
