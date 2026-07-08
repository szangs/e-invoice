// Mandanten-Dashboard: Kennzahlen + letzte Rechnungen
import { InvoiceStatus, Role } from '@prisma/client'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BasketStrip } from '@/components/baskets/BasketStrip'
import { ensureSystemBaskets, getBasketCounts, sortBaskets } from '@/lib/baskets'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { formatAmount, STATUS_LABELS } from '@/lib/invoices'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const ctx = await getContext()
  if (ctx.role === Role.OPERATOR_ADMIN && !ctx.tenantId) redirect('/platform')
  const tenantId = ctx.tenantId as string

  await ensureSystemBaskets(tenantId)

  // Weich gelöschte Rechnungen (Papierkorb) tauchen im Dashboard nicht auf
  const [total, byStatus, recent, basketsRaw, basketCounts] = await Promise.all([
    prisma.invoice.count({ where: { tenantId, deletedAt: null } }),
    prisma.invoice.groupBy({ by: ['status'], where: { tenantId, deletedAt: null }, _count: true }),
    prisma.invoice.findMany({ where: { tenantId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.basket.findMany({ where: { tenantId, deletedAt: null } }),
    getBasketCounts(tenantId, ctx.userId),
  ])
  const count = (s: InvoiceStatus) => byStatus.find((b) => b.status === s)?._count ?? 0
  const baskets = sortBaskets(basketsRaw)

  // Ungelesene, an mich adressierte Nachrichten (Stefan 2026-07-08) — dasselbe
  // 💬-Symbol wie in der Ablagekörbe-Liste, auch hier auf einen Blick sichtbar.
  const unreadNoteRows = ctx.userId
    ? await prisma.invoiceNote.findMany({
        where: { invoiceId: { in: recent.map((i) => i.id) }, toUserId: ctx.userId, readAt: null },
        select: { invoiceId: true },
      })
    : []
  const unreadNoteInvoiceIds = new Set(unreadNoteRows.map((r) => r.invoiceId))

  const cards: { label: string; value: number; href: string; hint: string }[] = [
    { label: 'Rechnungen gesamt', value: total, href: '/invoices', hint: 'Alle nicht gelöschten Rechnungen öffnen' },
    { label: 'Neu', value: count(InvoiceStatus.NEW), href: '/invoices?status=NEW', hint: 'Noch nicht geprüfte Rechnungen anzeigen' },
    { label: 'Geprüft', value: count(InvoiceStatus.CHECKED), href: '/invoices?status=CHECKED', hint: 'Geprüfte Rechnungen anzeigen' },
    { label: 'Exportiert', value: count(InvoiceStatus.EXPORTED), href: '/invoices?status=EXPORTED', hint: 'Bereits exportierte Rechnungen anzeigen' },
  ]

  return (
    <div className="space-y-6">
      <section className="dp-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-gray-800" title="Rechnungen wandern durch Körbe wie in der klassischen Rechnungseingangsverarbeitung — Klick öffnet die Rechnungsliste gefiltert auf diesen Korb">
            🗂️ Körbe
          </h2>
          <Link href="/invoices" className="text-xs font-semibold text-[var(--accent)] hover:underline" title="Zu den Ablagekörben (öffnet den Eingangskorb)">
            Zu den Ablagekörben →
          </Link>
        </div>
        <BasketStrip
          baskets={baskets.map((b) => ({
            id: b.id, name: b.name, kind: b.kind,
            unprocessed: basketCounts[b.id]?.unprocessed ?? 0,
            processed: basketCounts[b.id]?.processed ?? 0,
            dueSoon: basketCounts[b.id]?.dueSoon ?? 0,
            overdue: basketCounts[b.id]?.overdue ?? 0,
            unreadNotes: basketCounts[b.id]?.unreadNotes ?? 0,
            readyForHandover: basketCounts[b.id]?.readyForHandover ?? 0,
          }))}
          activeBasketId={null}
          basePath="/invoices"
        />
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} title={c.hint} className="dp-card-sm block hover:border-[var(--accent-border)]">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{c.label}</p>
            <p className="mt-1 font-serif text-3xl font-semibold text-[var(--accent)]">{c.value}</p>
          </Link>
        ))}
      </div>

      <section className="dp-card p-0">
        <div className="flex items-center justify-between px-6 pb-2 pt-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Zuletzt erfasst</h2>
          <div className="flex gap-2">
            <Link href="/invoices/new" className="btn-primary" title="Elektronische Rechnung (PDF, XML, ZUGFeRD/XRechnung, Foto) hochladen">
              Rechnung hinzufügen
            </Link>
            <Link href="/invoices/new/scan" className="btn-secondary" title="Papierbeleg per Handy-Kamera oder Scanner erfassen">
              Papierrechnung scannen
            </Link>
          </div>
        </div>
        <table className="w-full">
          <thead>
            <tr className="dp-tr">
              <th className="dp-th">Lieferant</th>
              <th className="dp-th">Nummer</th>
              <th className="dp-th">Datum</th>
              <th className="dp-th">Brutto</th>
              <th className="dp-th">Status</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((i) => (
              <tr key={i.id} className="dp-tr">
                <td className="dp-td">
                  <Link className="text-[var(--accent)] hover:underline" href={`/invoices/${i.id}`}>{i.vendor}</Link>
                  {unreadNoteInvoiceIds.has(i.id) && (
                    <span className="ml-1.5" title="Ungelesene Nachricht an Sie — Rechnung öffnen zum Lesen">💬</span>
                  )}
                </td>
                <td className="dp-td font-mono text-xs">{i.invoiceNumber ?? '—'}</td>
                <td className="dp-td text-xs">
                  {i.invoiceDate ? format(i.invoiceDate, 'dd.MM.yyyy', { locale: de }) : '—'}
                </td>
                <td className="dp-td">{formatAmount(i.amountGross ? Number(i.amountGross) : null, i.currency)}</td>
                <td className="dp-td text-xs">{STATUS_LABELS[i.status]}</td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr><td className="dp-td py-8 text-center text-gray-400" colSpan={5}>
                Noch keine Rechnungen — starten Sie oben mit „Rechnung hinzufügen“ oder „Papierrechnung scannen“ (RE02).
              </td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
