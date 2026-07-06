// Rechnungsdetail — Server lädt, Client-Formular bearbeitet
import { notFound, redirect } from 'next/navigation'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { toDTO } from '@/lib/invoices'
import { InvoiceEditForm } from './InvoiceEditForm'

export const dynamic = 'force-dynamic'

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getContext()
  if (!ctx.tenantId) redirect('/platform')
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, tenantId: ctx.tenantId },
  })
  if (!invoice) notFound()
  return <InvoiceEditForm invoice={toDTO(invoice)} />
}
