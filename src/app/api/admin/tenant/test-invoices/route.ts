// "Testrechnungen senden" in den Mandanten-Einstellungen: der Mandant testet
// SEIN EIGENES Mail-Eingang-Postfach mit echten Beispielrechnungen (PDF/
// XRechnung/ZUGFeRD gemischt) — im Unterschied zum Betreiber-Cockpit-Knopf
// (api/platform/tenants/[id]/test-invoices, nur im Entwicklungsmodus) hier
// bewusst ohne diese Sperre: der Mandant testet nur sein eigenes Postfach,
// kein Eingriff des Betreibers in fremde Mandanten.
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { sendTestInvoicesToGraphFolder } from '@/lib/testInvoices'

const schema = z.object({ count: z.number().int().min(1).max(50).optional() })

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const { count } = schema.parse(await req.json().catch(() => ({})))
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        mailInGraphMailbox: true,
        mailInGraphFolder: true,
        mailInGraphTenantId: true,
        mailInGraphClientId: true,
        mailInGraphClientSecret: true,
      },
    })
    if (!tenant?.mailInGraphMailbox) {
      throw new ApiError(400, 'Bitte zuerst oben ein Postfach für den Mail-Eingang eintragen und speichern.')
    }
    const { sent, failed } = await sendTestInvoicesToGraphFolder(
      tenant,
      tenant.mailInGraphMailbox,
      tenant.mailInGraphFolder,
      count ?? 10,
    )
    return NextResponse.json({
      ok: true,
      message: `${sent} Testrechnung(en) in ${tenant.mailInGraphMailbox}${tenant.mailInGraphFolder ? '/' + tenant.mailInGraphFolder : ''} angelegt${failed > 0 ? `, ${failed} fehlgeschlagen` : ''}.`,
    })
  } catch (e) {
    return jsonError(e)
  }
}
