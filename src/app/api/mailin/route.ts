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
    const [entries, settings, tenant] = await Promise.all([
      prisma.mailIntake.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      getSettings(),
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { mailInGraphEnabled: true, mailInGraphMailbox: true, mailInGraphFolder: true },
      }),
    ])
    // Mandanten-Subdomain-Muster: beliebig@<kurzname>.<basis-domain> — als
    // Vorschlag zeigen wir "rechnung@…", der lokale Teil ist aber frei wählbar.
    const address =
      settings.MAIL_IN_DOMAIN && ctx.tenantSlug
        ? `rechnung@${ctx.tenantSlug}.${settings.MAIL_IN_DOMAIN}`
        : null
    // Zweiter, unabhängiger Abholkanal (Microsoft Graph) — eigener Status,
    // da ein Mandant ausschließlich darüber laufen kann und dann trotz
    // deaktiviertem SMTP-Katch-all ganz normal automatisch beliefert wird.
    const graphActive =
      settings.MAIL_IN_GRAPH_ENABLED === '1' && !!tenant?.mailInGraphEnabled && !!tenant?.mailInGraphMailbox
    return NextResponse.json({
      enabled: settings.MAIL_SMTP_ENABLED === '1',
      address,
      graph: {
        active: graphActive,
        mailbox: tenant?.mailInGraphMailbox ?? null,
        folder: tenant?.mailInGraphFolder ?? null,
      },
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
