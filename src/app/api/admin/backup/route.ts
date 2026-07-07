// Datensicherung des eigenen Mandanten (§17): Download + Sofort-Versand per E-Mail
import { NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { buildTenantBackup } from '@/lib/backup'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { sendSystemMail } from '@/lib/mail'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const { filename, json } = await buildTenantBackup(tenantId)
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'BACKUP_CREATED',
      details: 'Sicherung manuell heruntergeladen',
    })
    return new NextResponse(json, {
      headers: {
        'Content-Type': 'application/json',
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
    const to = tenant?.backupEmail || ctx.email
    if (!to) throw new ApiError(400, 'Keine Ziel-E-Mail hinterlegt.')
    const { filename, json } = await buildTenantBackup(tenantId)
    const mail = await sendSystemMail(
      to,
      `E-Invoice Datensicherung — ${tenant?.name ?? ''}`,
      'Anbei die angeforderte Datensicherung Ihres Mandanten.',
      [{ filename, content: json }],
    )
    if (!mail.sent) throw new ApiError(502, `Versand fehlgeschlagen: ${mail.reason}`)
    await prisma.tenant.update({ where: { id: tenantId }, data: { lastBackupAt: new Date() } })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'BACKUP_CREATED',
      details: `Sicherung per E-Mail an ${to} versendet`,
    })
    return NextResponse.json({ ok: true, message: `Sicherung an ${to} versendet.` })
  } catch (e) {
    return jsonError(e)
  }
}
