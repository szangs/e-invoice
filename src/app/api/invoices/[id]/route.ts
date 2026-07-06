// Rechnung bearbeiten / löschen — Mandantentrennung an der Quelle (§22)
import { NextRequest, NextResponse } from 'next/server'
import { InvoiceStatus } from '@prisma/client'
import { z } from 'zod'
import { jsonError } from '@/lib/api'
import { audit } from '@/lib/audit'
import { ApiError, getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { toDTO } from '@/lib/invoices'
import { deleteInvoiceFile } from '@/lib/storage'

const schema = z.object({
  vendor: z.string().min(1).optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  amountNet: z.number().nullable().optional(),
  amountTax: z.number().nullable().optional(),
  amountGross: z.number().nullable().optional(),
  currency: z.string().optional(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  tags: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

async function findOwn(id: string, tenantId: string) {
  const invoice = await prisma.invoice.findFirst({ where: { id, tenantId } })
  if (!invoice) throw new ApiError(404, 'Rechnung nicht gefunden')
  return invoice
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    await findOwn(params.id, tenantId)
    const data = schema.parse(await req.json())

    const invoice = await prisma.invoice.update({
      where: { id: params.id },
      data: {
        ...data,
        invoiceDate: data.invoiceDate === undefined ? undefined : data.invoiceDate ? new Date(data.invoiceDate) : null,
        dueDate: data.dueDate === undefined ? undefined : data.dueDate ? new Date(data.dueDate) : null,
      },
    })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'INVOICE_UPDATE',
      details: `Rechnung ${invoice.vendor} ${invoice.invoiceNumber ?? invoice.id} geändert`,
    })
    return NextResponse.json({ invoice: toDTO(invoice) })
  } catch (e) {
    return jsonError(e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await getContext()
    const tenantId = requireTenant(ctx)
    const invoice = await findOwn(params.id, tenantId)
    if (invoice.fileName) await deleteInvoiceFile(tenantId, invoice.fileName)
    await prisma.invoice.delete({ where: { id: invoice.id } })
    await audit({
      tenantId,
      actorId: ctx.userId,
      actorName: ctx.email,
      action: 'INVOICE_DELETE',
      details: `Rechnung ${invoice.vendor} ${invoice.invoiceNumber ?? invoice.id} gelöscht`,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
