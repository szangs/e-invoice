// Killswitch (§11): sperrt den Mandanten UND setzt Zwangsabmeldung für alle Nutzer.
// Betrifft NICHT Fernwartungssitzungen (eigener Abbruch, §14).
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ operator: true })
    const tenant = await prisma.tenant.findUnique({ where: { id: params.id } })
    if (!tenant) return NextResponse.json({ error: 'Mandant nicht gefunden.' }, { status: 404 })

    await prisma.$transaction([
      prisma.tenant.update({ where: { id: tenant.id }, data: { active: false } }),
      prisma.user.updateMany({ where: { tenantId: tenant.id }, data: { forcedLogoutAt: new Date() } }),
    ])
    await audit({
      tenantId: tenant.id,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'TENANT_KILLSWITCH',
      details: `Killswitch für "${tenant.name}": alle Nutzer abgemeldet, Mandant gesperrt`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
