// CSV-Export (Semikolon, UTF-8 mit BOM für Excel) — respektiert die Listenfilter
import { NextRequest, NextResponse } from 'next/server'
import { InvoiceStatus, Prisma } from '@prisma/client'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { STATUS_LABELS } from '@/lib/invoices'

function csvField(v: string | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function num(v: Prisma.Decimal | null): string {
  return v === null ? '' : Number(v).toFixed(2).replace('.', ',')
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q') ?? ''
    const status = searchParams.get('status') as InvoiceStatus | null

    const invoices = await prisma.invoice.findMany({
      where: {
        tenantId,
        deletedAt: null, // Papierkorb nicht im CSV-Export
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { vendor: { contains: q, mode: 'insensitive' } },
                { invoiceNumber: { contains: q, mode: 'insensitive' } },
                { tags: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { invoiceDate: 'desc' },
    })

    const header = [
      'Dokumenten-ID', 'Lieferant', 'Rechnungsnummer', 'Rechnungsdatum', 'Fälligkeit',
      'Netto', 'Steuer', 'Brutto', 'Währung', 'Status', 'Tags', 'Notizen',
    ].join(';')
    const rows = invoices.map((i) =>
      [
        csvField(i.docId),
        csvField(i.vendor),
        csvField(i.invoiceNumber),
        i.invoiceDate ? i.invoiceDate.toISOString().slice(0, 10) : '',
        i.directDebitByVendor ? 'wird abgebucht' : i.dueDate ? i.dueDate.toISOString().slice(0, 10) : '',
        num(i.amountNet),
        num(i.amountTax),
        num(i.amountGross),
        i.currency,
        STATUS_LABELS[i.status],
        csvField(i.tags),
        csvField(i.notes),
      ].join(';'),
    )
    const csv = '﻿' + [header, ...rows].join('\r\n')

    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'INVOICE_EXPORT',
      details: `CSV-Export: ${invoices.length} Rechnungen`,
    })
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="rechnungen-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}
