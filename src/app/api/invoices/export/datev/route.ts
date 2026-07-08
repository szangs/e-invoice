// DATEV-Export für den Übergabekorb (Stefan 2026-07-08) — siehe lib/datev.ts
// für Format-Details/Einschränkungen. Exportiert alle noch nicht an die
// Buchhaltung übergebenen Rechnungen (checkAccountingAt = null) im
// angegebenen Korb, markiert sie danach als übergeben/exportiert (damit ein
// erneuter Export dieselben Rechnungen nicht doppelt bucht) und protokolliert
// den Vorgang im Audit-Log. Nur aus dem Übergabekorb möglich (kind=HANDOVER).
import { NextRequest, NextResponse } from 'next/server'
import { BasketKind, InvoiceStatus } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { hasBasketRight } from '@/lib/basketRights'
import { ensureSystemBaskets } from '@/lib/baskets'
import { buildDatevExport } from '@/lib/datev'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { hasFeature } from '@/lib/license'
import { sendSystemMail } from '@/lib/mail'
import { readInvoiceFile } from '@/lib/storage'

const schema = z.object({
  basketId: z.string().min(1),
  sendIndividualMails: z.boolean().optional(),
  // Inhalts-Verschlüsselung (Stefan 2026-07-09): bei verschlüsselten
  // Mandanten baut der CLIENT die CSV selbst (er hat als Einziger die
  // entschlüsselten Beträge/Lieferanten) — hier wird dann nur noch anhand
  // dieser IDs markiert/verschoben, ohne den Export-Teil unten erneut zu tun.
  invoiceIds: z.array(z.string()).optional(),
})

const READY_FOR_EXPORT_WHERE = {
  deletedAt: null,
  checkAccountingAt: null,
  checkElectronicAt: { not: null },
  checkFormalAt: { not: null },
  checkSubstantiveAt: { not: null },
} as const

/**
 * Kandidaten für den DATEV-Export eines Korbs (Stefan 2026-07-09) — für
 * verschlüsselte Mandanten liest der Client hierüber die contentEnc-Blobs,
 * entschlüsselt sie im Browser und baut die CSV selbst (buildDatevExport ist
 * eine reine Funktion ohne Server-Abhängigkeiten, siehe lib/datev.ts).
 */
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
    if (!basket) throw new ApiError(404, 'Korb nicht gefunden.')
    if (basket.kind !== BasketKind.HANDOVER) {
      throw new ApiError(400, 'DATEV-Export ist nur im Übergabekorb möglich.')
    }
    if (!tenant) throw new ApiError(404, 'Mandant nicht gefunden.')
    if (!hasFeature(tenant, 'DATEV')) throw new ApiError(403, 'DATEV-Export ist im aktuellen Tarif nicht enthalten.')
    if (!(await hasBasketRight(ctx.userId, ctx.role, basket.id, 'FIBU'))) {
      throw new ApiError(403, 'Kein Recht zur Übergabe an die Fibu.')
    }
    const invoices = await prisma.invoice.findMany({
      where: { tenantId, basketId, ...READY_FOR_EXPORT_WHERE },
      orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }],
    })
    const vendorAccountRows = await prisma.vendorAccount.findMany({ where: { tenantId } })
    const vendorAccounts = Object.fromEntries(
      vendorAccountRows.map((v) => [v.vendorName.trim().toLowerCase(), v.konto]),
    )
    return NextResponse.json({
      invoices: invoices.map((i) => ({
        id: i.id,
        docId: i.docId,
        invoiceDate: i.invoiceDate ? i.invoiceDate.toISOString() : null,
        createdAt: i.createdAt.toISOString(),
        contentEnc: i.contentEnc,
        // Klartext-Fallback nur, wenn diese Rechnung KEIN contentEnc hat (z. B.
        // vor Aktivierung der Verschlüsselung angelegt) — sonst null, der
        // Client entschlüsselt in dem Fall contentEnc selbst.
        vendor: i.contentEnc ? null : i.vendor,
        invoiceNumber: i.contentEnc ? null : i.invoiceNumber,
        amountNet: i.contentEnc ? null : i.amountNet !== null ? Number(i.amountNet) : null,
        amountTax: i.contentEnc ? null : i.amountTax !== null ? Number(i.amountTax) : null,
        amountGross: i.contentEnc ? null : i.amountGross !== null ? Number(i.amountGross) : null,
        currency: i.currency,
      })),
      settings: {
        datevBeraternr: tenant.datevBeraternr,
        datevMandantnr: tenant.datevMandantnr,
        datevSachkontenlaenge: tenant.datevSachkontenlaenge,
        datevKreditorenkonto: tenant.datevKreditorenkonto,
        datevGegenkonto: tenant.datevGegenkonto,
        datevWjBeginn: tenant.datevWjBeginn,
      },
      vendorAccounts,
      exportedBy: ctx.email,
    })
  } catch (e) {
    return jsonError(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const { basketId, sendIndividualMails, invoiceIds } = schema.parse(await req.json())

    const [basket, tenant] = await Promise.all([
      prisma.basket.findFirst({ where: { id: basketId, tenantId } }),
      prisma.tenant.findUnique({ where: { id: tenantId } }),
    ])
    if (!basket) throw new ApiError(404, 'Korb nicht gefunden.')
    if (basket.kind !== BasketKind.HANDOVER) {
      throw new ApiError(400, 'DATEV-Export ist nur im Übergabekorb möglich.')
    }
    if (!tenant) throw new ApiError(404, 'Mandant nicht gefunden.')
    if (!hasFeature(tenant, 'DATEV')) throw new ApiError(403, 'DATEV-Export ist im aktuellen Tarif nicht enthalten.')
    if (!(await hasBasketRight(ctx.userId, ctx.role, basket.id, 'FIBU'))) {
      throw new ApiError(403, 'Kein Recht zur Übergabe an die Fibu.')
    }

    // Client-seitiger Export bei Verschlüsselung (Stefan 2026-07-09): die CSV
    // wurde im Browser aus den entschlüsselten Daten gebaut (siehe GET oben +
    // DatevExportButton.tsx) — hier nur noch die übergebenen IDs als
    // exportiert markieren/in die Ablage verschieben, dieselben Nebeneffekte
    // wie beim serverseitigen Pfad unten, nur ohne die CSV erneut zu bauen.
    if (invoiceIds && invoiceIds.length > 0) {
      const marked = await prisma.invoice.findMany({
        where: { id: { in: invoiceIds }, tenantId, basketId, ...READY_FOR_EXPORT_WHERE },
        select: { id: true },
      })
      if (marked.length === 0) {
        throw new ApiError(400, 'Keine gültigen Rechnungen zum Markieren gefunden.')
      }
      const { archiveId } = await ensureSystemBaskets(tenantId)
      const now = new Date()
      await prisma.invoice.updateMany({
        where: { id: { in: marked.map((i) => i.id) } },
        data: { checkAccountingAt: now, checkAccountingBy: ctx.email, status: InvoiceStatus.EXPORTED, basketId: archiveId },
      })
      await audit({
        tenantId,
        actorId: ctx.userId,
        actorName: ctx.email,
        action: 'INVOICE_EXPORT',
        details: `DATEV-Export (Übergabekorb "${basket.name}", client-seitig/verschlüsselt): ${marked.length} Rechnung(en) an Fibu übergeben`,
      })
      return NextResponse.json({ ok: true, count: marked.length })
    }

    // Stefan 2026-07-09: nur vollständig geprüfte Rechnungen dürfen in den
    // DATEV-Export — Elektronische Vorprüfung, Formal richtig und Sachlich
    // richtig müssen alle abgehakt sein. Unvollständige Rechnungen bleiben
    // einfach im Übergabekorb liegen (sichtbar an den Häkchen in der Liste)
    // und werden beim nächsten Export automatisch mitgenommen, sobald sie fertig sind.
    const invoices = await prisma.invoice.findMany({
      where: {
        tenantId,
        basketId,
        amountGross: { not: null },
        ...READY_FOR_EXPORT_WHERE,
      },
      orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }],
    })
    if (invoices.length === 0) {
      throw new ApiError(400, 'Keine vollständig geprüften Rechnungen mit Bruttobetrag in diesem Korb zum Export.')
    }

    // Optionale Lieferanten→Konto-Zuordnung (Stefan 2026-07-08, per CSV-Import
    // in den Mandanten-Einstellungen befüllt) — ohne Treffer gilt weiterhin
    // das Sammelkonto aus den Tenant-Einstellungen.
    const vendorAccountRows = await prisma.vendorAccount.findMany({ where: { tenantId } })
    const vendorAccounts = Object.fromEntries(
      vendorAccountRows.map((v) => [v.vendorName.trim().toLowerCase(), v.konto]),
    )

    const csv = buildDatevExport(
      invoices.map((i) => ({
        vendor: i.vendor,
        invoiceNumber: i.invoiceNumber,
        docId: i.docId,
        invoiceDate: i.invoiceDate,
        createdAt: i.createdAt,
        amountNet: i.amountNet !== null ? Number(i.amountNet) : null,
        amountTax: i.amountTax !== null ? Number(i.amountTax) : null,
        amountGross: i.amountGross !== null ? Number(i.amountGross) : null,
        currency: i.currency,
      })),
      tenant,
      { exportedBy: ctx.email },
      vendorAccounts,
    )

    // Ablage (Stefan 2026-07-09): exportierte Rechnungen wandern automatisch
    // in den festen Ablagekorb und bleiben dort — nur Admin kann sie von da
    // wieder herausverschieben.
    const { archiveId } = await ensureSystemBaskets(tenantId)

    const now = new Date()
    await prisma.invoice.updateMany({
      where: { id: { in: invoices.map((i) => i.id) } },
      data: { checkAccountingAt: now, checkAccountingBy: ctx.email, status: InvoiceStatus.EXPORTED, basketId: archiveId },
    })

    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'INVOICE_EXPORT',
      details: `DATEV-Export (Übergabekorb "${basket.name}"): ${invoices.length} Rechnung(en) an Fibu übergeben`,
    })

    // Optional zusätzlich: eine einzelne E-Mail je Beleg mit dem Original-
    // Dokument im Anhang (Stefan 2026-07-08) — der DATEV-CSV enthält nur
    // Buchungsdaten, keine Dokumente. Nur unverschlüsselte Belege können
    // serverseitig angehängt werden (Zero-Knowledge).
    let mailSent = 0
    let mailFailed = 0
    if (sendIndividualMails && tenant.datevFibuEmail) {
      for (const inv of invoices) {
        try {
          const lines = [
            `Lieferant: ${inv.vendor}`,
            `Rechnungsnummer: ${inv.invoiceNumber ?? '—'}`,
            `Rechnungsdatum: ${inv.invoiceDate ? inv.invoiceDate.toISOString().slice(0, 10) : '—'}`,
            `Netto: ${inv.amountNet ?? '—'} ${inv.currency}`,
            `Steuer: ${inv.amountTax ?? '—'} ${inv.currency}`,
            `Brutto: ${inv.amountGross ?? '—'} ${inv.currency}`,
            `Dokumenten-ID: ${inv.docId ?? '—'}`,
          ]
          if (inv.encrypted) lines.push('', 'Hinweis: Beleg ist Zero-Knowledge-verschlüsselt — bitte in E-Invoice öffnen.')
          const attachments =
            !inv.encrypted && inv.fileName
              ? [{ filename: inv.originalName ?? 'beleg.pdf', content: await readInvoiceFile(tenantId, inv.fileName) }]
              : undefined
          const result = await sendSystemMail(
            tenant.datevFibuEmail,
            `Rechnung ${inv.docId ?? ''} — ${inv.vendor}`.trim(),
            lines.join('\n'),
            attachments,
          )
          if (result.sent) mailSent++
          else mailFailed++
        } catch {
          mailFailed++
        }
      }
      await audit({
        tenantId,
        actorId: ctx.userId,
        actorName: ctx.email,
        action: 'INVOICE_EXPORT',
        details: `Einzel-Mails an Fibu (${tenant.datevFibuEmail}): ${mailSent} gesendet, ${mailFailed} fehlgeschlagen`,
      })
    }

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="EXTF_Buchungsstapel_${now.toISOString().slice(0, 10)}.csv"`,
        'X-Mail-Sent': String(mailSent),
        'X-Mail-Failed': String(mailFailed),
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}
