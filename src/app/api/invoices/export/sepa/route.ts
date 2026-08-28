// SEPA-Sammelüberweisung für den Übergabekorb (Stefan 2026-08-27, Review-
// Fund "welche Export-Module an Fibu noch wichtig wären") — siehe lib/sepa.ts
// für das Dateiformat. Arbeitet auf DENSELBEN vollständig geprüften
// Rechnungen wie der DATEV-Export (siehe api/invoices/export/datev), ist
// aber ein eigenständiger, wiederholbarer Export ohne Nebeneffekt auf den
// Rechnungs-Status — anders als der DATEV-Export markiert dieser hier NICHTS
// als "exportiert" (kein eigenes Zahlungsstatus-Tracking, das wäre ein
// eigenes Feature). Nur für unverschlüsselte Mandanten (Server kennt
// Lieferant/Betrag bei Verschlüsselung nicht, Zero-Knowledge — analog zum
// Belegbilder-ZIP im DATEV-Export).
import { NextRequest, NextResponse } from 'next/server'
import { BasketKind } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { hasBasketRight } from '@/lib/basketRights'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { hasFeature } from '@/lib/license'
import { buildSepaCreditTransfer, isValidIban, isValidBic } from '@/lib/sepa'

const READY_FOR_EXPORT_WHERE = {
  deletedAt: null,
  checkAccountingAt: null,
  checkElectronicAt: { not: null },
  checkFormalAt: { not: null },
  checkSubstantiveAt: { not: null },
  amountGross: { not: null },
} as const

async function loadCandidates(tenantId: string, basketId: string) {
  const invoices = await prisma.invoice.findMany({
    where: { tenantId, basketId, ...READY_FOR_EXPORT_WHERE },
    orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }],
  })
  const vendorNames = Array.from(new Set(invoices.map((i) => i.vendor)))
  const vendorRows = await prisma.vendorAddress.findMany({
    where: { tenantId, vendorName: { in: vendorNames } },
    select: { vendorName: true, iban: true, bic: true, ibanVerifiedAt: true },
  })
  const byVendor = new Map(vendorRows.map((v) => [v.vendorName, v]))
  return invoices.map((i) => {
    const v = byVendor.get(i.vendor)
    return {
      id: i.id,
      docId: i.docId,
      vendor: i.vendor,
      invoiceNumber: i.invoiceNumber,
      amountGross: i.amountGross !== null ? Number(i.amountGross) : null,
      currency: i.currency,
      directDebitByVendor: i.directDebitByVendor,
      iban: v?.iban ?? null,
      bic: v?.bic ?? null,
      ibanVerified: Boolean(v?.ibanVerifiedAt),
    }
  })
}

/** Kandidaten + Auftraggeberkonto-Status für die Auswahl-Ansicht (SepaExportButton.tsx). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const basketId = req.nextUrl.searchParams.get('basketId')
    if (!basketId) throw new ApiError(400, 'basketId fehlt.')
    const [basket, tenant] = await Promise.all([
      prisma.basket.findFirst({ where: { id: basketId, tenantId } }),
      prisma.tenant.findUnique({ where: { id: tenantId } }),
    ])
    if (!basket || basket.kind !== BasketKind.HANDOVER) throw new ApiError(400, 'SEPA-Export ist nur im Übergabekorb möglich.')
    if (!tenant) throw new ApiError(404, 'Mandant nicht gefunden.')
    if (!hasFeature(tenant, 'DATEV')) throw new ApiError(403, 'SEPA-Export ist im aktuellen Tarif nicht enthalten.')
    if (!(await hasBasketRight(ctx.userId, ctx.role, basket.id, 'FIBU'))) {
      throw new ApiError(403, 'Kein Recht zur Übergabe an die Fibu.')
    }
    if (tenant.encryptionEnabled) throw new ApiError(400, 'SEPA-Export ist für verschlüsselte Mandanten noch nicht verfügbar.')

    const invoices = await loadCandidates(tenantId, basketId)
    return NextResponse.json({
      invoices,
      ownAccount: { name: tenant.sepaOwnName, iban: tenant.sepaOwnIban, bic: tenant.sepaOwnBic },
      ownAccountConfigured: Boolean(tenant.sepaOwnName && tenant.sepaOwnIban && isValidIban(tenant.sepaOwnIban)),
    })
  } catch (e) {
    return jsonError(e)
  }
}

const schema = z.object({
  basketId: z.string().min(1),
  invoiceIds: z.array(z.string()).min(1),
  executionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const { basketId, invoiceIds, executionDate } = schema.parse(await req.json())

    const [basket, tenant] = await Promise.all([
      prisma.basket.findFirst({ where: { id: basketId, tenantId } }),
      prisma.tenant.findUnique({ where: { id: tenantId } }),
    ])
    if (!basket || basket.kind !== BasketKind.HANDOVER) throw new ApiError(400, 'SEPA-Export ist nur im Übergabekorb möglich.')
    if (!tenant) throw new ApiError(404, 'Mandant nicht gefunden.')
    if (!hasFeature(tenant, 'DATEV')) throw new ApiError(403, 'SEPA-Export ist im aktuellen Tarif nicht enthalten.')
    if (!(await hasBasketRight(ctx.userId, ctx.role, basket.id, 'FIBU'))) {
      throw new ApiError(403, 'Kein Recht zur Übergabe an die Fibu.')
    }
    if (tenant.encryptionEnabled) throw new ApiError(400, 'SEPA-Export ist für verschlüsselte Mandanten noch nicht verfügbar.')

    if (!tenant.sepaOwnName || !tenant.sepaOwnIban || !isValidIban(tenant.sepaOwnIban)) {
      throw new ApiError(400, 'Eigene Bankverbindung (Auftraggeberkonto) fehlt oder ist ungültig — bitte zuerst in den Mandanten-Einstellungen → DATEV-Export eintragen.')
    }
    if (tenant.sepaOwnBic && !isValidBic(tenant.sepaOwnBic)) {
      throw new ApiError(400, 'BIC des Auftraggeberkontos ist ungültig.')
    }

    const candidates = await loadCandidates(tenantId, basketId)
    const selected = candidates.filter((c) => invoiceIds.includes(c.id))
    if (selected.length === 0) throw new ApiError(400, 'Keine gültigen Rechnungen ausgewählt.')

    const rejected: string[] = []
    const payments = selected
      .map((c) => {
        if (c.currency !== 'EUR') {
          rejected.push(`${c.docId ?? c.id} (${c.vendor}): Währung ${c.currency}, SEPA nur für EUR`)
          return null
        }
        if (c.amountGross === null || c.amountGross <= 0) {
          rejected.push(`${c.docId ?? c.id} (${c.vendor}): kein gültiger Betrag`)
          return null
        }
        if (!c.iban || !c.ibanVerified) {
          rejected.push(`${c.docId ?? c.id} (${c.vendor}): Kontoverbindung fehlt oder nicht bestätigt (Lieferanten-Adressregister)`)
          return null
        }
        if (!isValidIban(c.iban)) {
          rejected.push(`${c.docId ?? c.id} (${c.vendor}): IBAN ungültig`)
          return null
        }
        if (c.bic && !isValidBic(c.bic)) {
          rejected.push(`${c.docId ?? c.id} (${c.vendor}): BIC ungültig`)
          return null
        }
        return {
          endToEndId: c.docId ?? c.id,
          creditorName: c.vendor,
          creditorIban: c.iban,
          creditorBic: c.bic,
          amount: c.amountGross,
          remittanceInfo: c.invoiceNumber ? `Rechnung ${c.invoiceNumber}` : `Beleg ${c.docId ?? c.id}`,
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)

    if (payments.length === 0) {
      throw new ApiError(400, `Keine der ausgewählten Rechnungen ist zahlungsbereit:\n${rejected.join('\n')}`)
    }

    const { xml, totalAmount, count } = buildSepaCreditTransfer(
      { name: tenant.sepaOwnName, iban: tenant.sepaOwnIban, bic: tenant.sepaOwnBic },
      payments,
      new Date(executionDate),
    )

    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'SEPA_EXPORT',
      details: `SEPA-Sammelüberweisung erzeugt (Übergabekorb "${basket.name}"): ${count} Zahlung(en), ${totalAmount.toFixed(2)} EUR${rejected.length > 0 ? ` · ${rejected.length} übersprungen: ${rejected.join('; ')}` : ''}`,
    })

    return new NextResponse(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="SEPA_Sammelueberweisung_${executionDate}.xml"`,
        'X-Sepa-Count': String(count),
        'X-Sepa-Total': totalAmount.toFixed(2),
        'X-Sepa-Rejected': encodeURIComponent(rejected.join(' | ')),
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}
