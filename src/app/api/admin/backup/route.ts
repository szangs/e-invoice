// Datensicherung des eigenen Mandanten (§17, Stefan 2026-07-08 umgestellt):
// GET = sofortiger, authentifizierter ZIP-Download (kein Token/Link nötig,
// der Admin ist ja bereits angemeldet). POST = Sicherungspaket erstellen +
// Download-Link per E-Mail zustellen (statt Anhang) — dieselbe Logik wie der
// automatische Zeitplan, siehe lib/backupPackage.ts.
import { NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { buildTenantBackupZip, deliverTenantBackupPackage } from '@/lib/backupPackage'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const { buffer, originalName } = await buildTenantBackupZip(tenantId)
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'BACKUP_CREATED',
      details: `Sicherung manuell heruntergeladen (${originalName})`,
    })
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${originalName}"`,
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
    if (!tenant) throw new ApiError(404, 'Mandant nicht gefunden')
    const to = tenant.backupEmail || ctx.email
    if (!to) throw new ApiError(400, 'Keine Ziel-E-Mail hinterlegt.')

    const result = await deliverTenantBackupPackage({ ...tenant, backupEmail: to })
    if (!result.mailSent) throw new ApiError(502, result.log.join(' · '))

    await prisma.tenant.update({ where: { id: tenantId }, data: { lastBackupAt: new Date() } })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'BACKUP_CREATED',
      details: `Sicherungspaket manuell erstellt, Download-Link an ${to} versendet`,
    })
    return NextResponse.json({ ok: true, message: `Download-Link an ${to} versendet.` })
  } catch (e) {
    return jsonError(e)
  }
}
