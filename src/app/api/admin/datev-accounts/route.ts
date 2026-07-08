// Optionale Lieferanten→Konto-Zuordnung für den DATEV-Export (Stefan
// 2026-07-08): per CSV-Import befüllbar, siehe VendorAccount im Schema.
// Erwartetes Format: Semikolon- oder komma-getrennt, ERSTE Zeile ist immer
// eine Kopfzeile (wird übersprungen), danach je Zeile "Lieferantenname;Konto".
import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const rows = await prisma.vendorAccount.findMany({ where: { tenantId }, orderBy: { vendorName: 'asc' } })
    return NextResponse.json({ accounts: rows })
  } catch (e) {
    return jsonError(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext({ roles: [Role.TENANT_ADMIN] })
    const tenantId = requireTenant(ctx)
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, 'Keine Datei erhalten.')
    if (file.size > 2 * 1024 * 1024) throw new ApiError(400, 'Datei zu groß (max. 2 MB).')

    const text = await file.text()
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) throw new ApiError(400, 'Keine Datenzeilen gefunden (erste Zeile gilt als Kopfzeile).')

    let imported = 0
    const skipped: string[] = []
    for (const line of lines.slice(1)) {
      const parts = line.split(/[;,]/).map((p) => p.trim().replace(/^"|"$/g, ''))
      const vendorName = parts[0]
      const konto = parts[1]
      if (!vendorName || !konto) {
        skipped.push(line)
        continue
      }
      await prisma.vendorAccount.upsert({
        where: { tenantId_vendorName: { tenantId, vendorName } },
        update: { konto },
        create: { tenantId, vendorName, konto },
      })
      imported++
    }

    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'DATEV_ACCOUNTS_IMPORT',
      details: `${imported} Lieferanten-Konto-Zuordnung(en) importiert${skipped.length ? `, ${skipped.length} Zeile(n) übersprungen` : ''}`,
    })
    return NextResponse.json({ ok: true, imported, skipped: skipped.length })
  } catch (e) {
    return jsonError(e)
  }
}
