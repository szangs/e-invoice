// E-Mail-Eingang, Betreiberseite: Live-Protokoll aller Mandanten. Eingang
// läuft ausschließlich über den eigenen SMTP-Empfänger (scripts/smtp-server.ts,
// Catch-All) — kein manueller Abruf nötig, Mails kommen sofort beim Empfang an.
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { getSettings } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await getContext({ operator: true })
    const sinceId = new URL(req.url).searchParams.get('since') ?? ''
    const [entries, tenants, settings] = await Promise.all([
      prisma.mailIntake.findMany({
        where: sinceId ? { id: { gt: sinceId } } : {},
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.tenant.findMany({ select: { id: true, name: true } }),
      getSettings(),
    ])
    const names = Object.fromEntries(tenants.map((t) => [t.id, t.name]))
    return NextResponse.json({
      enabled: settings.MAIL_SMTP_ENABLED === '1',
      configured: Boolean(settings.MAIL_IN_DOMAIN && settings.MAIL_SMTP_ENABLED === '1'),
      entries: entries.map((e) => ({
        id: e.id,
        createdAt: e.createdAt,
        tenantName: e.tenantId ? names[e.tenantId] ?? '—' : null,
        fromAddress: e.fromAddress,
        toAddress: e.toAddress,
        subject: e.subject,
        status: e.status,
        detail: e.detail,
      })),
    })
  } catch (e) {
    return jsonError(e)
  }
}
