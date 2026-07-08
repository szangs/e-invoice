// "Vermissen Sie hier eine Schnittstelle?" (Stefan 2026-07-08) — kleines
// Formular im Übergabekorb neben dem DATEV-Export, mit dem Mandanten eine
// gewünschte Buchhaltungs-Schnittstelle (z. B. Lexware, sevDesk, Addison)
// direkt an Stefan melden können. Kein eigener Datensatz nötig — geht per
// Mail an den festen Support-Kontakt (siehe /support-Seite).
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { getContext, requireTenant } from '@/lib/context'
import { sendSystemMail } from '@/lib/mail'

const SUPPORT_EMAIL = 'stefan.zangs@deltaplus.de'

const schema = z.object({
  software: z.string().min(1).max(120),
  message: z.string().max(2000).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext()
    requireTenant(ctx)
    const { software, message } = schema.parse(await req.json())

    const lines = [
      `Mandant: ${ctx.tenantName ?? '—'}`,
      `Von: ${ctx.email}`,
      `Gewünschte Schnittstelle: ${software}`,
      ...(message ? ['', message] : []),
    ]
    const result = await sendSystemMail(
      SUPPORT_EMAIL,
      `Schnittstellen-Wunsch: ${software} (${ctx.tenantName ?? ctx.email})`,
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
