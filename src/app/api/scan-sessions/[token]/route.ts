// GET: öffentlicher Status-Check (Stefan 2026-08-27) — bewusst OHNE Login,
// das Handy hat keine Anmeldung. Der Token selbst ist das einzige
// Berechtigungsmerkmal (wie ein Einmal-Passwort) — wer ihn kennt (per
// QR-Code gescannt), darf diese eine Sitzung sehen/bedienen, sonst nichts.
// DELETE: die PC-Seite schließt die Sitzung vorzeitig — dafür ist eine
// normale Anmeldung nötig (der PC ist ja bereits angemeldet) plus die
// Prüfung, dass die Sitzung wirklich zum eigenen Mandanten gehört.
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { closeScanSession, getValidScanSession } from '@/lib/scanSession'

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const session = await getValidScanSession(params.token)
    return NextResponse.json({ valid: true, expiresAt: session.expiresAt })
  } catch (e) {
    return jsonError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const session = await getValidScanSession(params.token)
    if (session.tenantId !== tenantId) throw new ApiError(404, 'Sitzung nicht gefunden.')
    await closeScanSession(session.id, session.tenantId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
