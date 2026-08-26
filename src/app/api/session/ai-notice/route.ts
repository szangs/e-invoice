// KI-/Sicherungs-Hinweis beim Login (Stefan 2026-08-26): erscheint bei
// Mandanten mit aktivierter KI erneut, sobald sich seit der letzten
// Bestätigung THRESHOLD echte Logins angesammelt haben (User.aiNoticeLoginCount,
// siehe lib/auth.ts). Reine Anzeige-/Erinnerungsfunktion, keine Sperre.
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'

const THRESHOLD = 10

export async function GET() {
  try {
    const ctx = await getContext()
    if (!ctx.tenantId) return NextResponse.json({ show: false })
    const [user, tenant] = await Promise.all([
      prisma.user.findUnique({ where: { id: ctx.userId }, select: { aiNoticeLoginCount: true } }),
      prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { aiAllowed: true } }),
    ])
    const show = Boolean(tenant?.aiAllowed) && (user?.aiNoticeLoginCount ?? 0) >= THRESHOLD
    return NextResponse.json({ show })
  } catch (e) {
    return jsonError(e)
  }
}

export async function POST() {
  try {
    const ctx = await getContext()
    await prisma.user.update({
      where: { id: ctx.userId },
      data: { aiNoticeLoginCount: 0, aiNoticeAckedAt: new Date() },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
