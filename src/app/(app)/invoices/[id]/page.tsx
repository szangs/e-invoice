// Rechnungsdetail — E-Rechnungs-Ansicht (Rechnungsbild) + Bearbeitungsformular
import { notFound, redirect } from 'next/navigation'
import { ensureSystemBaskets } from '@/lib/baskets'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { parseInvoiceXml, validateData, type DocFormat } from '@/lib/erechnung'
import { toDTO } from '@/lib/invoices'
import { ERechnungView } from './ERechnungView'
import { InvoiceEditForm } from './InvoiceEditForm'
import { InvoicePdfPreview } from './InvoicePdfPreview'

export const dynamic = 'force-dynamic'

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getContext()
  if (!ctx.tenantId) redirect('/platform')
  const tenantId = ctx.tenantId
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, tenantId },
  })
  if (!invoice) notFound()

  await ensureSystemBaskets(tenantId)
  const baskets = await prisma.basket.findMany({
    where: { tenantId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true },
  })
  const approvals = await prisma.basketApproval.findMany({
    where: { invoiceId: invoice.id },
    select: { targetBasketId: true, user: { select: { email: true } } },
  })
  const pending = approvals.length > 0
    ? {
        targetName: baskets.find((b) => b.id === approvals[0].targetBasketId)?.name ?? '?',
        approvedBy: approvals.map((a) => a.user.email),
        needed: Math.max(0, 2 - approvals.length),
      }
    : null

  // Rechnungsbild: bei digitalen Formaten die XML-Daten visualisieren
  const parsed = invoice.xmlData ? parseInvoiceXml(invoice.xmlData) : null
  const data = parsed?.data ?? null
  const format = (invoice.docFormat as DocFormat | null) ?? parsed?.format ?? null

  return (
    <div className="space-y-6">
      {format === 'ZUGFERD' && invoice.fileName && (
        <InvoicePdfPreview
          invoiceId={invoice.id}
          encrypted={invoice.encrypted}
          origMime={invoice.encOrigMime}
        />
      )}
      {format && format !== 'OTHER' && (format !== 'PDF' || invoice.validationOk !== null) && (
        <ERechnungView
          format={format}
          data={data}
          validation={data ? validateData(data) : null}
        />
      )}
      <InvoiceEditForm invoice={toDTO(invoice)} baskets={baskets} pendingApproval={pending} />
    </div>
  )
}
