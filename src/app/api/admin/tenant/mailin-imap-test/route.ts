// Verbindungs-/Ordner-Test für den IMAP-basierten Mail-Eingang (Mandanten-Einstellungen)
import { NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { testImapMailbox } from '@/lib/imapMailin'
import { friendlyMailinAuthError } from '@/lib/mailinAuthError'

export async function POST() {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        mailInImapHost: true, mailInImapPort: true, mailInImapSecure: true,
        mailInImapUser: true, mailInImapPass: true, mailInImapFolder: true,
      },
    })
    if (!tenant) throw new ApiError(404, 'Mandant nicht gefunden')
    try {
      const result = await testImapMailbox(tenant, tenant.mailInImapFolder)
      return NextResponse.json({
        ok: true,
        message: `Verbindung erfolgreich — Ordner "${tenant.mailInImapFolder || 'INBOX'}", ${result.messageCount} Nachricht(en).`,
      })
    } catch (e) {
      const detail = friendlyMailinAuthError(e)
      return NextResponse.json({ ok: false, message: detail })
    }
  } catch (e) {
    return jsonError(e)
  }
}
