// Rechnungsdetail — E-Rechnungs-Ansicht (Rechnungsbild) + Bearbeitungsformular
import { notFound, redirect } from 'next/navigation'
import { isInvoiceLockedByClosure } from '@/lib/auditClosure'
import { hasBasketRight } from '@/lib/basketRights'
import { ensureSystemBaskets, sortBaskets } from '@/lib/baskets'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { buyerNameMismatch, parseInvoiceXml, validateData, type DocFormat } from '@/lib/erechnung'
import { toDTO } from '@/lib/invoices'
import { AttachmentsPanel } from './AttachmentsPanel'
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
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { encryptionEnabled: true, costCentersEnabled: true, legalName: true } }),
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
  const validation = data ? validateData(data) : null
  const locked = await isInvoiceLockedByClosure(invoice.createdAt)
  // Vorschlags-Absenderadresse für "Korrektur anfordern" (Stefan 2026-08-25)
  // — nur ein Vorschlag aus dem Notiztext (lib/mailin.ts: "... · von
  // {from}"), der Nutzer sieht/bestätigt sie vor dem Senden im Formular.
  const suggestedVendorEmail = invoice.notes?.match(/·\s*von\s+(\S+@\S+)/)?.[1] ?? null
  // Firmenbezeichnung-Abgleich (Stefan 2026-08-25) — nur relevant, wenn der
  // Mandant eine exakte Firmenbezeichnung hinterlegt hat UND die Rechnung
  // einen strukturierten Rechnungsempfänger enthält.
  const hasBuyerMismatch = buyerNameMismatch(tenant?.legalName ?? null, data?.buyerName ?? null)
  const buyerNameCheck = hasBuyerMismatch
    ? {
        invoiceId: invoice.id,
        expected: tenant!.legalName!,
        actual: data!.buyerName!,
        acknowledged: invoice.buyerNameMismatchAcknowledged,
        locked,
      }
    : null

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
            validation={validation}
            buyerNameCheck={buyerNameCheck}
          />
        )}
        <InvoiceEditForm
          validationMissing={validation && !validation.valid ? validation.missing : null}
          suggestedVendorEmail={suggestedVendorEmail}
          invoice={toDTO(invoice)}
          baskets={baskets}
          pendingApproval={pending}
          encryptionEnabled={tenant?.encryptionEnabled ?? false}
          costCentersEnabled={tenant?.costCentersEnabled ?? false}
          colleagues={colleagues}
          locked={locked}
        />
      </div>
      <div className="space-y-4 lg:sticky lg:top-4">
        {/* Mailtext GANZ OBEN (Stefan 2026-08-25): unabhängig vom Beleg selbst
            eintreffende Zusatzinformation — steht deshalb VOR der eigentlichen
            Beleg-Visualisierung, klar als E-Mail-Nachricht statt als Rechnung
            gekennzeichnet, damit Herkunft und Bedeutung sofort klar sind. */}
        {invoice.mailBodyText && (
          <div>
            <h3 className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-gray-500"
              title="Text der E-Mail, mit der dieser Beleg eintraf — kann zusätzliche, nicht auf dem Beleg selbst stehende Hinweise enthalten">
              ✉️ Als E-Mail-Nachricht empfangen
            </h3>
            <pre className="dp-card max-h-64 overflow-y-auto whitespace-pre-wrap break-words bg-[var(--surface-muted)] font-sans text-xs text-gray-700">
              {invoice.mailBodyText}
            </pre>
          </div>
        )}
        {invoice.fileName && (
          <div>
            <h3 className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-gray-500"
              title={invoice.htmlRendered
                ? 'Kein vom Lieferanten mitgeschicktes Original — aus dem HTML-Mailtext oben nachgebildet'
                : 'Der eigentliche Rechnungsbeleg'}>
              📄 Beleg{invoice.htmlRendered ? ' (aus Dokumenten-Text rekonstruiert, kein Original)' : ''}
            </h3>
            <BelegPreview
              invoiceId={invoice.id}
              encrypted={invoice.encrypted}
              origMime={invoice.encOrigMime}
              mimeType={invoice.mimeType}
              originalName={invoice.originalName}
              mockData={data}
              mockFormat={format}
            />
          </div>
        )}
        {/* Weitere Anhänge UNTER dem Beleg (Stefan 2026-08-25): bewusst
            nachrangig zur eigentlichen Beleg-Visualisierung, jetzt visuell
            statt nur als Download-Link dargestellt. */}
        <AttachmentsPanel invoiceId={invoice.id} encryptionEnabled={tenant?.encryptionEnabled ?? false} locked={locked} />
      </div>
    </div>
  )
}
