// Lieferanten-Adressregister als eigenständiger Export für die Fibu (Stefan
// 2026-08-26) — CSV mit Lieferant + zuletzt übermittelter Anschrift, siehe
// lib/vendorMemory.ts upsertVendorAddress (dort wird die Tabelle nachgeführt).
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

function csvField(v: string | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET() {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const rows = await prisma.vendorAddress.findMany({ where: { tenantId }, orderBy: { vendorName: 'asc' } })

    const header = ['Lieferant', 'Anschrift', 'Zuletzt aktualisiert'].join(';')
    const csvRows = rows.map((r) =>
      [csvField(r.vendorName), csvField(r.address), r.updatedAt.toISOString().slice(0, 10)].join(';'),
    )
    const csv = '﻿' + [header, ...csvRows].join('\r\n')

    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'VENDOR_ADDRESSES_EXPORT',
      details: `Lieferanten-Adressregister exportiert: ${rows.length} Lieferant(en)`,
    })
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="lieferanten-adressen-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}
