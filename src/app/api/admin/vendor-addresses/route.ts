// Lieferanten-Adressregister anzeigen (Stefan 2026-08-26) — reine Lesezugriff
// für VendorAddressesPanel.tsx, die Pflege läuft automatisch, siehe
// lib/vendorMemory.ts upsertVendorAddress.
import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const addresses = await prisma.vendorAddress.findMany({ where: { tenantId }, orderBy: { vendorName: 'asc' } })
    return NextResponse.json({ addresses })
  } catch (e) {
    return jsonError(e)
  }
}
