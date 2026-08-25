// "Testrechnungen senden"-Knopf im Betreiber-Cockpit (Stefan 2026-08-24):
// legt N Beispielrechnungen (PDF/XRechnung/ZUGFeRD gemischt) direkt im für
// den Mail-Eingang dieses Mandanten konfigurierten Graph-Ordner an — zum
// Durchklicken von Mail-Eingang, KI-Erkennung und E-Rechnungs-Visualisierung,
// ohne Kommandozeile. Bewusst NICHT per sendMail verschickt (Stefan
// 2026-08-25): eine so eintreffende Mail landet zwar im Postfach, aber eine
// dort eingerichtete Regel ("nach Rechnungseingang verschieben") greift bei
// per API gesendeter Post beobachtbar oft nicht — siehe createGraphTestMessage
// in lib/graphMailin.ts. Reine Test-/Demo-Funktion, deshalb nur im
// Entwicklungsmodus verfügbar (wie der Graph-Zugangsdaten-Fallback).
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { ApiError, getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { isDevMode } from '@/lib/settings'
import { sendTestInvoicesToGraphFolder } from '@/lib/testInvoices'

const schema = z.object({ count: z.number().int().min(1).max(50).optional() })

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await getContext({ operator: true })
    if (!(await isDevMode())) {
      throw new ApiError(403, 'Nur im Entwicklungsmodus verfügbar (Systemeinstellungen → Schalter).')
    }
    const { count } = schema.parse(await req.json().catch(() => ({})))
    const tenant = await prisma.tenant.findUnique({
      where: { id: params.id },
      select: {
        name: true,
        mailInGraphMailbox: true,
        mailInGraphFolder: true,
        mailInGraphTenantId: true,
        mailInGraphClientId: true,
        mailInGraphClientSecret: true,
      },
    })
    if (!tenant) throw new ApiError(404, 'Mandant nicht gefunden')
    if (!tenant.mailInGraphMailbox) {
      throw new ApiError(400, `Für "${tenant.name}" ist noch kein Postfach für den Mail-Eingang hinterlegt (Mandanten-Einstellungen → Allgemein).`)
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
