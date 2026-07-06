// Anmelde-Vorprüfung (§5, Schritt 1) — öffentlicher Endpunkt (bewusste Ausnahme, §4)
// Ergebnisfälle: mehrere Mandanten → Auswahl; gesperrt/Wartung → klare Meldung; sonst ok.
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { prisma } from '@/lib/db'
import { getSetting } from '@/lib/settings'
import { jsonError } from '@/lib/api'

const schema = z.object({ email: z.string().email(), password: z.string().min(1) })

export async function POST(req: NextRequest) {
  try {
    const { email, password } = schema.parse(await req.json())
    const mail = email.trim().toLowerCase()

    const users = await prisma.user.findMany({
      where: { email: mail },
      include: { tenant: true },
    })

    // Passwort gegen alle Treffer prüfen (gleiche Person kann bei mehreren Mandanten existieren, §2)
    const valid = []
    for (const u of users) {
      if (await bcrypt.compare(password, u.passwordHash)) valid.push(u)
    }
    if (valid.length === 0) {
      await audit({ actorName: mail, action: 'LOGIN_FAILED', details: 'Vorprüfung: ungültige Zugangsdaten' })
      return NextResponse.json({ error: 'E-Mail oder Passwort ist falsch.' }, { status: 401 })
    }

    const maintenance = (await getSetting('MAINTENANCE_LOCK')) === '1'
    const results = []
    for (const u of valid) {
      if (!u.active) continue
      if (u.tenantId === null) {
        // Betreiber-Administrator — von Wartungssperre ausgenommen (§9)
        results.push({ tenantId: 'operator', tenantName: 'Betreiber-Ebene (Plattform)' })
        continue
      }
      if (!u.tenant?.active) {
        await audit({ tenantId: u.tenantId, actorName: mail, action: 'LOGIN_FAILED', details: 'Mandant gesperrt' })
        return NextResponse.json(
          { error: 'Ihr Zugang ist derzeit nicht erreichbar. Bitte kontaktieren Sie den Support.' },
          { status: 403 },
        )
      }
      if (maintenance) {
        await audit({ tenantId: u.tenantId, actorName: mail, action: 'LOGIN_FAILED', details: 'Wartungssperre aktiv' })
        return NextResponse.json(
          { error: 'Die Anmeldung ist wegen Wartungsarbeiten vorübergehend deaktiviert.' },
          { status: 503 },
        )
      }
      results.push({ tenantId: u.tenantId, tenantName: u.tenant.name })
    }

    if (results.length === 0) {
      return NextResponse.json({ error: 'Ihr Konto ist deaktiviert. Bitte kontaktieren Sie den Support.' }, { status: 403 })
    }
    return NextResponse.json({ tenants: results })
  } catch (e) {
    return jsonError(e)
  }
}
