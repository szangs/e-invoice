// Verbindungs-Test für den POP3-basierten Mail-Eingang (Mandanten-Einstellungen)
import { NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { friendlyMailinAuthError } from '@/lib/mailinAuthError'
import { testPop3Mailbox } from '@/lib/pop3Mailin'

export async function POST() {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { mailInPop3Host: true, mailInPop3Port: true, mailInPop3Secure: true, mailInPop3User: true, mailInPop3Pass: true },
    })
    if (!tenant) throw new ApiError(404, 'Mandant nicht gefunden')
    try {
      const result = await testPop3Mailbox(tenant)
      return NextResponse.json({ ok: true, message: `Verbindung erfolgreich — ${result.messageCount} Nachricht(en) im Postfach.` })
    } catch (e) {
      const detail = friendlyMailinAuthError(e)
      return NextResponse.json({ ok: false, message: detail })
    }
  } catch (e) {
    return jsonError(e)
  }
}
