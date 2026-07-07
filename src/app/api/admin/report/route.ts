// Revisionssicherer Hash-Bericht des eigenen Mandanten: Download + Sofort-Versand
import { NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { sendSystemMail } from '@/lib/mail'
import { buildHashReport } from '@/lib/report'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const { filename, csv } = await buildHashReport(tenantId)
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'REPORT_CREATED',
      details: 'Revisionssicherer Bericht manuell heruntergeladen',
    })
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}

export async function POST() {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    const to = tenant?.reportEmail || ctx.email
    if (!to) throw new ApiError(400, 'Keine Ziel-E-Mail hinterlegt.')
    const { filename, csv, hash, count } = await buildHashReport(tenantId)
    const mail = await sendSystemMail(
      to,
      `E-Invoice Revisionssicherer Bericht — ${tenant?.name ?? ''}`,
      `Guten Tag,\n\nanbei der angeforderte revisionssichere Bericht Ihrer Rechnungen (${count}) ` +
        `mit Prüfsumme je Beleg.\n\nBericht-Hash: ${hash}\n`,
      [{ filename, content: csv }],
    )
    if (!mail.sent) throw new ApiError(502, `Versand fehlgeschlagen: ${mail.reason}`)
    await prisma.tenant.update({ where: { id: tenantId }, data: { lastReportAt: new Date(), lastReportHash: hash } })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'REPORT_SENT',
      details: `Revisionssicherer Bericht per E-Mail an ${to} versendet`,
    })
    return NextResponse.json({ ok: true, message: `Bericht an ${to} versendet.` })
  } catch (e) {
    return jsonError(e)
  }
}
