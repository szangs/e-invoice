// Prüft für den aktuellen Mandanten, ob die KI-gestützte Datenerkennung
// (gescannte Rechnungen) nutzbar ist — ohne Geheimnisse preiszugeben.
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { isAiConfigured } from '@/lib/aiExtract'
import { getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new Error('Mandant nicht gefunden')
    if (!tenant.aiAllowed) {
      return NextResponse.json({ available: false, reason: 'KI-Funktionen sind für Ihren Mandanten deaktiviert.' })
    }
    if (tenant.encryptionEnabled) {
      return NextResponse.json({
        available: false,
        reason: 'Bei aktiver Beleg-Verschlüsselung nicht verfügbar (Zero-Knowledge).',
      })
    }
    if (!(await isAiConfigured())) {
      return NextResponse.json({ available: false, reason: 'Kein KI-Anbieter konfiguriert.' })
    }
    return NextResponse.json({ available: true })
  } catch (e) {
    return jsonError(e)
  }
}
