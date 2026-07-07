// Rechnungsdetail — E-Rechnungs-Ansicht (Rechnungsbild) + Bearbeitungsformular
import { notFound, redirect } from 'next/navigation'
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
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, tenantId: ctx.tenantId },
  })
  if (!invoice) notFound()

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
      <InvoiceEditForm invoice={toDTO(invoice)} />
    </div>
  )
}
