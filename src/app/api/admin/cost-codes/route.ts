// Kostenstellen/Kostenträger (Stefan 2026-07-09, #114): optionale, im
// Mandanten-Stamm abschaltbare Buchungsdimension — genau wie die Lieferanten-
// Konten (siehe api/admin/datev-accounts) per CSV-Import befüllbar. Format:
// Semikolon- oder komma-getrennt, ERSTE Zeile ist immer eine Kopfzeile (wird
// übersprungen), danach je Zeile "Code;Bezeichnung".
import { NextRequest, NextResponse } from 'next/server'
import { CostCodeKind, Role } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { hasFeature } from '@/lib/license'

const kindSchema = z.nativeEnum(CostCodeKind)

export async function GET(req: NextRequest) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const kindParam = new URL(req.url).searchParams.get('kind')
    const kind = kindSchema.safeParse(kindParam)
    if (!kind.success) throw new ApiError(400, 'Ungültige oder fehlende Angabe "kind" (KOSTENSTELLE|KOSTENTRAEGER).')
    const rows = await prisma.costCode.findMany({
      where: { tenantId, kind: kind.data },
      orderBy: { code: 'asc' },
    })
    return NextResponse.json({ codes: rows })
  } catch (e) {
    return jsonError(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant || !hasFeature(tenant, 'COST_CENTERS')) {
      throw new ApiError(403, 'Kostenstellen/Kostenträger sind im aktuellen Tarif nicht enthalten.')
    }
    const form = await req.formData()
    const file = form.get('file')
    const kindRaw = form.get('kind')
    const kind = kindSchema.safeParse(kindRaw)
    if (!kind.success) throw new ApiError(400, 'Ungültige oder fehlende Angabe "kind" (KOSTENSTELLE|KOSTENTRAEGER).')
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, 'Keine Datei erhalten.')
    if (file.size > 2 * 1024 * 1024) throw new ApiError(400, 'Datei zu groß (max. 2 MB).')

    const text = await file.text()
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) throw new ApiError(400, 'Keine Datenzeilen gefunden (erste Zeile gilt als Kopfzeile).')

    let imported = 0
    const skipped: string[] = []
    for (const line of lines.slice(1)) {
      const parts = line.split(/[;,]/).map((p) => p.trim().replace(/^"|"$/g, ''))
      const code = parts[0]
      const name = parts[1]
      if (!code || !name) {
        skipped.push(line)
        continue
      }
      await prisma.costCode.upsert({
        where: { tenantId_kind_code: { tenantId, kind: kind.data, code } },
        update: { name },
        create: { tenantId, kind: kind.data, code, name },
      })
      imported++
    }

    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'COST_CODES_IMPORT',
      details: `${imported} ${kind.data === 'KOSTENSTELLE' ? 'Kostenstelle(n)' : 'Kostenträger'} importiert${skipped.length ? `, ${skipped.length} Zeile(n) übersprungen` : ''}`,
    })
    return NextResponse.json({ ok: true, imported, skipped: skipped.length })
  } catch (e) {
    return jsonError(e)
  }
}
