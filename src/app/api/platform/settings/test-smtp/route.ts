// Verbindungs-/Versand-Test für den SMTP-Mailversand (§24) — Stefan 2026-07-08:
// bislang ließ sich die SMTP-Konfiguration nur indirekt (z. B. beim Anlegen
// eines Benutzers) prüfen. Verschickt eine echte Testmail an eine frei
// wählbare Adresse über die aktuell gespeicherten SMTP_*-Einstellungen.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { getContext } from '@/lib/context'
import { sendSystemMail } from '@/lib/mail'

const schema = z.object({ to: z.string().email() })

export async function POST(req: NextRequest) {
  try {
    await getContext({ operator: true })
    const { to } = schema.parse(await req.json())
    const started = Date.now()
    const result = await sendSystemMail(
      to,
      'E-Invoice — Test-Mail',
      `Dies ist eine Testmail der SMTP-Konfiguration von E-Invoice, gesendet am ${new Date().toLocaleString('de-DE')}.\n\n` +
        'Wenn Sie diese Mail erhalten, ist der Mailversand korrekt eingerichtet.',
    )
    const ms = Date.now() - started
    if (!result.sent) {
      return NextResponse.json({ ok: false, message: result.reason ?? 'Versand fehlgeschlagen.' })
    }
    return NextResponse.json({ ok: true, message: `Testmail an ${to} versendet (${ms} ms).` })
  } catch (e) {
    return jsonError(e)
  }
}
