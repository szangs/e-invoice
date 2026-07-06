// Fernwartung §14A — Bildschirmspiegel: Nutzer sendet maskierten DOM-Spiegel (POST),
// Betreiber ruft ihn ab (GET). Automatischer Zeitabschluss nach globalem Timeout (§9).
import { NextRequest, NextResponse } from 'next/server'
import { Role, SupportStatus } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { getSetting } from '@/lib/settings'

export const dynamic = 'force-dynamic'

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const session = await prisma.supportSession.findUnique({ where: { id: params.id } })
    if (!session || session.userId !== ctx.userId) throw new ApiError(403, 'Keine Berechtigung')
    if (session.status !== SupportStatus.ACTIVE) return NextResponse.json({ ended: true })

    // Globaler Zeitabschluss (§9): Sitzung automatisch beenden
    const timeoutMin = Number((await getSetting('SUPPORT_TIMEOUT_MIN')) || 30)
    if (session.startedAt && Date.now() - session.startedAt.getTime() > timeoutMin * 60_000) {
      await prisma.supportSession.update({
        where: { id: session.id },
        data: { status: SupportStatus.ENDED, endedAt: new Date(), endedBy: 'Zeitabschluss', snapshot: null },
      })
      await audit({
        tenantId: session.tenantId,
        actorName: 'System',
        action: 'SUPPORT_ENDED',
        details: `Fernwartung automatisch beendet (Zeitabschluss ${timeoutMin} min)`,
      })
      return NextResponse.json({ ended: true })
    }

    const { html } = (await req.json()) as { html?: string }
    if (!html) throw new ApiError(400, 'Kein Spiegel-Inhalt')
    if (Buffer.byteLength(html, 'utf8') > MAX_SNAPSHOT_BYTES) {
      return NextResponse.json({ ok: true, skipped: 'zu groß' })
    }
    await prisma.supportSession.update({
      where: { id: session.id },
      data: { snapshot: html, snapshotAt: new Date() },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    if (ctx.role !== Role.OPERATOR_ADMIN) throw new ApiError(403, 'Nur für den Betreiber')
    const session = await prisma.supportSession.findUnique({
      where: { id: params.id },
      select: { status: true, snapshot: true, snapshotAt: true, startedAt: true, tenantId: true },
    })
    if (!session) throw new ApiError(404, 'Sitzung nicht gefunden')
    return NextResponse.json(session)
  } catch (e) {
    return jsonError(e)
  }
}
