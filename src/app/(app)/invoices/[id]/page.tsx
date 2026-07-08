// Rechnungsdetail — E-Rechnungs-Ansicht (Rechnungsbild) + Bearbeitungsformular
import { notFound, redirect } from 'next/navigation'
import { hasBasketRight } from '@/lib/basketRights'
import { ensureSystemBaskets, sortBaskets } from '@/lib/baskets'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { parseInvoiceXml, validateData, type DocFormat } from '@/lib/erechnung'
import { toDTO } from '@/lib/invoices'
import { BelegPreview } from './BelegPreview'
import { ERechnungView } from './ERechnungView'
import { InvoiceEditForm } from './InvoiceEditForm'

export const dynamic = 'force-dynamic'

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getContext()
  if (!ctx.tenantId) redirect('/platform')
  const tenantId = ctx.tenantId
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, tenantId },
  })
  if (!invoice) notFound()

  // Korb-Recht CONTENT nötig, um die Rechnung überhaupt zu öffnen (Stefan
  // 2026-07-09) — sonst könnte jeder Mandanten-Mitarbeiter eine fremde
  // Rechnungs-ID direkt aufrufen, unabhängig von seinen Korb-Rechten.
  if (invoice.basketId && !(await hasBasketRight(ctx.userId, ctx.role, invoice.basketId, 'CONTENT'))) {
    redirect('/invoices')
  }

  await ensureSystemBaskets(tenantId)
  const baskets = sortBaskets(await prisma.basket.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true, kind: true, position: true },
  }))
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

  const [tenant, colleaguesRaw] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { encryptionEnabled: true } }),
    prisma.user.findMany({
      where: { tenantId, active: true },
      select: { id: true, email: true, firstName: true, lastName: true },
      orderBy: { email: 'asc' },
    }),
  ])
  const colleagues = colleaguesRaw.map((u) => ({
    id: u.id,
    name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
  }))

  // Rechnungsbild: bei digitalen Formaten die XML-Daten visualisieren
  const parsed = invoice.xmlData ? parseInvoiceXml(invoice.xmlData) : null
  const data = parsed?.data ?? null
  const format = (invoice.docFormat as DocFormat | null) ?? parsed?.format ?? null

  // Layout (Stefan 2026-07-09, #113): zwei Spalten auf breiten Bildschirmen —
  // links die Daten (E-Rechnungs-Auswertung + Bearbeitungsformular), rechts
  // sticky das Belegbild, damit man beim Ablesen/Übertragen nicht scrollen
  // muss. Gilt für ZUGFeRD/XRechnung genauso wie für reine Scans (vorher gab
  // es dort gar kein Bild auf dieser Seite). Auf schmalen Bildschirmen fällt
  // die rechte Spalte einfach unter die linke.
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-6">
        {format && format !== 'OTHER' && (format !== 'PDF' || invoice.validationOk !== null) && (
          <ERechnungView
            format={format}
            data={data}
            validation={data ? validateData(data) : null}
          />
        )}
        <InvoiceEditForm
          invoice={toDTO(invoice)}
          baskets={baskets}
          pendingApproval={pending}
          encryptionEnabled={tenant?.encryptionEnabled ?? false}
          colleagues={colleagues}
        />
      </div>
      {invoice.fileName && (
        <div className="lg:sticky lg:top-4">
          <BelegPreview
            invoiceId={invoice.id}
            encrypted={invoice.encrypted}
            origMime={invoice.encOrigMime}
            mimeType={invoice.mimeType}
            originalName={invoice.originalName}
          />
        </div>
      )}
    </div>
  )
}
