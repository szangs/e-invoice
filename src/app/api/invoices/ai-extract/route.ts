// KI-gestützte Datenerkennung aus einem Foto/Scan (nicht-elektronische
// Rechnungen, z. B. "Papierrechnung scannen"). Serverseitig erzwungen: nur
// wenn der Mandant KI-Funktionen erlaubt UND keine Beleg-Verschlüsselung
// aktiv ist — sonst dürfte der Klartext nie an einen externen KI-Anbieter
// gehen (Zero-Knowledge).
import { NextRequest, NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { extractInvoiceFromImage } from '@/lib/aiExtract'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

const MAX_BYTES = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant?.aiAllowed) throw new ApiError(403, 'KI-Funktionen sind für Ihren Mandanten deaktiviert.')
    if (tenant.encryptionEnabled) {
      throw new ApiError(403, 'Bei aktiver Beleg-Verschlüsselung nicht verfügbar (Zero-Knowledge).')
    }
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, 'Kein Bild erhalten.')
    if (file.size > MAX_BYTES) throw new ApiError(400, 'Datei zu groß (max. 10 MB).')
    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
    const data = await extractInvoiceFromImage(base64, file.type || 'image/jpeg')
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'AI_EXTRACT',
      details: 'KI-Datenerkennung für gescannte Rechnung ausgeführt',
    })
    return NextResponse.json({ ok: true, data })
  } catch (e) {
    return jsonError(e)
  }
}
