// E-Mail-Eingang, Mandantenseite: eigener Verlauf + eigene Einlieferungs-Adresse
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { getSettings } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const [entries, settings] = await Promise.all([
      prisma.mailIntake.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      getSettings(),
    ])
    // Mandanten-Subdomain-Muster: beliebig@<kurzname>.<basis-domain> — als
    // Vorschlag zeigen wir "rechnung@…", der lokale Teil ist aber frei wählbar.
    const address =
      settings.MAIL_IN_DOMAIN && ctx.tenantSlug
        ? `rechnung@${ctx.tenantSlug}.${settings.MAIL_IN_DOMAIN}`
        : null
    return NextResponse.json({
      enabled: settings.MAIL_IN_ENABLED === '1',
      address,
      entries: entries.map((e) => ({
        id: e.id,
        createdAt: e.createdAt,
        fromAddress: e.fromAddress,
        subject: e.subject,
        status: e.status,
        detail: e.detail,
        invoiceId: e.invoiceId,
      })),
    })
  } catch (e) {
    return jsonError(e)
  }
}
