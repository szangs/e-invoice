// Kurze Live-Visualisierung neu eingetroffener Rechnungen (Stefan 2026-08-25):
// egal auf welchem Weg eine Rechnung entsteht (SMTP-/Graph-Mail-Eingang,
// manueller Upload, Scan) — ist der Nutzer gerade online, pollt
// BasketStrip.tsx diese Route und lässt den betroffenen Korb kurz aufblinken
// (bewusst zurückhaltend statt eines Toasts, siehe Stefan 2026-08-25).
// Basket-Rechte werden dabei berücksichtigt (kein Aufblinken für Körbe, die
// der Nutzer gar nicht sehen darf).
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { getBasketRightMap, RIGHT_RANK } from '@/lib/basketRights'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const since = req.nextUrl.searchParams.get('since')
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 5 * 60_000)
    if (Number.isNaN(sinceDate.getTime())) throw new ApiError(400, 'Ungültiger Zeitstempel')

    const rightMap = await getBasketRightMap(tenantId, ctx.userId, ctx.role)
    const rows = await prisma.invoice.findMany({
      where: { tenantId, deletedAt: null, createdAt: { gt: sinceDate } },
      take: 50,
      select: { basketId: true },
    })
    const basketIds = Array.from(
      new Set(
        rows
          .map((r) => r.basketId)
          .filter((id): id is string => Boolean(id) && (rightMap[id!] ?? 0) >= RIGHT_RANK.VIEW),
      ),
    )

    return NextResponse.json({ now: new Date().toISOString(), basketIds })
  } catch (e) {
    return jsonError(e)
  }
}
