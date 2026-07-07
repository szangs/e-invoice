// Mandanten anlegen (§7) — nur Betreiber. Erster Administrator + Willkommens-Nachricht.
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { sendSystemMail } from '@/lib/mail'
import { generatePassword, generateUsername } from '@/lib/password'
import { getSetting } from '@/lib/settings'

/** Kurzliste aller Mandanten (für Auswahlfelder, z. B. Rücksicherung). */
export async function GET() {
  try {
    await getContext({ operator: true })
    const tenants = await prisma.tenant.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    })
    return NextResponse.json({ tenants })
  } catch (e) {
    return jsonError(e)
  }
}

const schema = z.object({
  slug: z.string().min(2).max(30).regex(/^[a-z0-9-]+$/, 'Nur Kleinbuchstaben, Ziffern, Bindestrich'),
  name: z.string().min(2),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactName: z.string().optional(),
  street: z.string().optional(),
  zip: z.string().optional(),
  city: z.string().optional(),
  employeeCount: z.coerce.number().int().min(0).default(0),
  maxUsers: z.coerce.number().int().min(1).default(5),
  licensePlan: z.string().optional(),
  licenseSerial: z.string().optional(),
  licenseExpiresAt: z.string().optional(), // ISO oder leer = unbegrenzt
  adminEmail: z.string().email(),
})

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ operator: true })
    const data = schema.parse(await req.json())

    const exists = await prisma.tenant.findUnique({ where: { slug: data.slug } })
    if (exists) return NextResponse.json({ error: 'Kurzname bereits vergeben.' }, { status: 409 })

    const password = generatePassword()
    const tenant = await prisma.tenant.create({
      data: {
        slug: data.slug,
        name: data.name,
        contactEmail: data.contactEmail || null,
        contactName: data.contactName || null,
        street: data.street || null,
        zip: data.zip || null,
        city: data.city || null,
        employeeCount: data.employeeCount,
        maxUsers: data.maxUsers,
        licensePlan: data.licensePlan || null,
        licenseSerial: data.licenseSerial || null,
        licenseExpiresAt: data.licenseExpiresAt ? new Date(data.licenseExpiresAt) : null,
        users: {
          create: {
            email: data.adminEmail.toLowerCase(),
            username: generateUsername(data.slug),
            passwordHash: await bcrypt.hash(password, 10),
            role: Role.TENANT_ADMIN,
            active: true,
          },
        },
      },
    })

    await audit({
      tenantId: tenant.id,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'TENANT_CREATE',
      details: `Mandant "${tenant.name}" (${tenant.slug}) angelegt, Admin: ${data.adminEmail}`,
    })

    // Willkommens-Nachricht mit Zugangsdaten (§7) — Anmeldung mit E-Mail + Passwort!
    let mailInfo = 'Willkommens-Mail deaktiviert.'
    if ((await getSetting('WELCOME_MAIL_ENABLED')) === '1') {
      const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
      const result = await sendSystemMail(
        data.adminEmail,
        `Ihr Zugang zu E-Invoice — ${tenant.name}`,
        [
          `Guten Tag,`,
          ``,
          `für "${tenant.name}" wurde ein Zugang eingerichtet.`,
          ``,
          `Adresse:   ${appUrl}`,
          `Anmeldung: ${data.adminEmail} (mit dieser E-Mail, nicht mit dem Benutzernamen)`,
          `Passwort:  ${password}`,
          ``,
          `Bitte ändern Sie das Passwort nach der ersten Anmeldung.`,
        ].join('\n'),
      )
      mailInfo = result.sent ? 'Willkommens-Mail versendet.' : `Mail nicht versendet: ${result.reason}`
    }

    // Die echten Zugangsdaten gehen zusätzlich an den Betreiber zurück (interne Benachrichtigung, §7)
    return NextResponse.json({
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      credentials: { email: data.adminEmail, password, note: 'Anmeldung erfolgt mit E-Mail + Passwort.' },
      mailInfo,
    })
  } catch (e) {
    return jsonError(e)
  }
}
