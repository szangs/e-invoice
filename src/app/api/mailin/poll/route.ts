// Manueller Abruf des Microsoft-Graph-Mail-Eingangs (Stefan 2026-08-25) — für
// den kleinen "Jetzt abrufen"-Knopf auf der Eingangskorb-Kachel, statt auf
// den nächsten planmäßigen Poll (MAIL_IN_GRAPH_POLL_SECONDS) zu warten. Nur
// auf den eigenen Mandanten beschränkt (siehe runGraphMailinPoll tenantId).
// Der SMTP-Mail-Eingang braucht das nicht — der ist bereits sofort aktiv.
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { runGraphMailinPoll } from '@/lib/graphMailin'

export async function POST() {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    // Kein Fehler, sondern nur ein Hinweis (Stefan 2026-08-25): der Knopf
    // steht immer auf der Eingangskorb-Kachel, unabhängig davon, ob der
    // Mandant Graph-Mail-Eingang überhaupt nutzt (SMTP-Eingang ist ohnehin
    // schon sofort aktiv) — "Fehler" wäre hier irreführend.
    if (!tenant?.mailInGraphEnabled || !tenant.mailInGraphMailbox) {
      return NextResponse.json({ ok: true, log: ['Kein Microsoft-Graph-Mail-Eingang aktiv (Mandanten-Einstellungen) — der SMTP-Mail-Eingang läuft bereits automatisch.'] })
    }
    const log = await runGraphMailinPoll(tenantId)
    return NextResponse.json({ ok: true, log })
  } catch (e) {
    return jsonError(e)
  }
}
