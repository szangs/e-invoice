// "Korrektur anfordern" (Stefan 2026-08-25): bewusst KEIN automatischer
// Versand bei erkannten Formal-/Pflichtangaben-Fehlern — ein Mensch prüft
// den vorausgefüllten Text und löst den Versand aktiv aus (siehe Diskussion:
// automatischer Versand an unbekannte/potenziell falsche Absenderadressen
// birgt dasselbe Backscatter-/Fehladressierungs-Risiko wie beim
// Spam-Hinweis, siehe lib/mailin.ts sendSpamNotice). Im Entwicklermodus wird
// wie dort NIE tatsächlich versendet.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { requireInvoiceContentAccess } from '@/lib/basketRights'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { sendSystemMail } from '@/lib/mail'
import { hasRoleAction } from '@/lib/roleActions'
import { isDevMode } from '@/lib/settings'

const schema = z.object({
  to: z.string().email(),
  message: z.string().min(1).max(4000),
})

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const invoice = await prisma.invoice.findFirst({ where: { id: params.id, tenantId } })
    if (!invoice) throw new ApiError(404, 'Rechnung nicht gefunden.')
    await requireInvoiceContentAccess(ctx, invoice.basketId)
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { roleActions: true } })
    if (!hasRoleAction(tenant, ctx.role, 'REQUEST_CORRECTION')) {
      throw new ApiError(403, 'Ihre Rolle darf keine Korrektur beim Lieferanten anfordern.')
    }

    const { to, message } = schema.parse(await req.json())

    if (await isDevMode()) {
      return NextResponse.json({
        ok: true,
        devSkipped: true,
        message: 'Entwicklermodus aktiv — es wurde keine echte Mail versendet.',
      })
    }

    const subject = `Korrektur erforderlich: Rechnung ${invoice.invoiceNumber ?? invoice.docId ?? invoice.id}`
    const result = await sendSystemMail(to, subject, message)
    if (!result.sent) {
      return NextResponse.json({ error: result.reason ?? 'Versand fehlgeschlagen' }, { status: 502 })
    }

    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'INVOICE_REQUEST_CORRECTION',
      details: `Korrektur angefordert für Rechnung ${invoice.invoiceNumber ?? invoice.docId} — an ${to}`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
