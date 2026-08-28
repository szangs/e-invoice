// Manueller Abruf des aktiven Mail-Eingang-Abrufwegs (Graph/POP3/IMAP,
// Stefan 2026-08-25/27) — für den kleinen "Jetzt abrufen"-Knopf auf der
// Eingangskorb-Kachel, statt auf den nächsten planmäßigen Poll zu warten.
// Nur auf den eigenen Mandanten beschränkt. Der SMTP-Mail-Eingang braucht
// das nicht — der ist bereits sofort aktiv.
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { runGraphMailinPoll } from '@/lib/graphMailin'
import { runImapMailinPoll } from '@/lib/imapMailin'
import { runPop3MailinPoll } from '@/lib/pop3Mailin'

export async function POST() {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    // respectSchedule=false (Stefan 2026-08-27): der manuelle Knopf soll
    // IMMER sofort abrufen, unabhängig vom eigenen Poll-Intervall des
    // Mandanten (siehe lib/mailinSchedule.ts) — genau der Zweck des Knopfs.
    if (tenant?.mailInGraphEnabled && tenant.mailInGraphMailbox) {
      return NextResponse.json({ ok: true, log: await runGraphMailinPoll(tenantId, false) })
    }
    if (tenant?.mailInPop3Enabled && tenant.mailInPop3Host) {
      return NextResponse.json({ ok: true, log: await runPop3MailinPoll(tenantId, false) })
    }
    if (tenant?.mailInImapEnabled && tenant.mailInImapHost) {
      return NextResponse.json({ ok: true, log: await runImapMailinPoll(tenantId, false) })
    }
    // Kein Fehler, sondern nur ein Hinweis (Stefan 2026-08-25): der Knopf
    // steht immer auf der Eingangskorb-Kachel, unabhängig davon, welches
    // Verfahren der Mandant nutzt — "Fehler" wäre hier irreführend.
    return NextResponse.json({ ok: true, log: ['Kein aktiver Abruf-Weg (Mandanten-Einstellungen) — der SMTP-Mail-Eingang läuft bereits automatisch.'] })
  } catch (e) {
    return jsonError(e)
  }
}
