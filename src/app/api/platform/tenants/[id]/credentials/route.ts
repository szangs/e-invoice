// Zugangsdaten (§7): Passwort des Mandanten-Admins zurücksetzen / erneut zusenden.
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { sendSystemMail } from '@/lib/mail'
import { generatePassword } from '@/lib/password'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext({ operator: true })
    const admin = await prisma.user.findFirst({
      where: { tenantId: params.id, role: Role.TENANT_ADMIN },
      include: { tenant: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!admin) return NextResponse.json({ error: 'Kein Mandanten-Administrator gefunden.' }, { status: 404 })

    const password = generatePassword()
    await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash: await bcrypt.hash(password, 10), forcedLogoutAt: new Date() },
    })
    await audit({
      tenantId: params.id,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'USER_PASSWORD_RESET',
      details: `Passwort für ${admin.email} zurückgesetzt (Betreiber)`,
    })

    const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
    const mail = await sendSystemMail(
      admin.email,
      `Neue Zugangsdaten — ${admin.tenant?.name ?? 'E-Invoice'}`,
      [
        `Guten Tag,`,
        ``,
        `Ihre Zugangsdaten wurden neu gesetzt.`,
        ``,
        `Adresse:   ${appUrl}`,
        `Anmeldung: ${admin.email} (E-Mail + Passwort)`,
        `Passwort:  ${password}`,
      ].join('\n'),
    )
    return NextResponse.json({
      credentials: { email: admin.email, password },
      mailInfo: mail.sent ? 'Mail versendet.' : `Mail nicht versendet: ${mail.reason}`,
    })
  } catch (e) {
    return jsonError(e)
  }
}
