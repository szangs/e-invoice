// Identitätsübernahme (§12): Betreiber erhält Einmal-Ticket für den Mandanten-Admin.
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { Role } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ operator: true })
    const target = await prisma.user.findFirst({
      where: { tenantId: params.id, role: Role.TENANT_ADMIN, active: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!target) {
      return NextResponse.json({ error: 'Kein aktiver Mandanten-Administrator vorhanden.' }, { status: 404 })
    }
    const ticket = await prisma.loginTicket.create({
      data: {
        code: randomBytes(24).toString('hex'),
        targetUserId: target.id,
        impersonatorId: ctx.userId,
        impersonatorName: ctx.email,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    return NextResponse.json({ ticket: ticket.code })
  } catch (e) {
    return jsonError(e)
  }
}
