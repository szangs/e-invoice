// Mandanten-Dashboard: Kennzahlen + letzte Rechnungen
import { InvoiceStatus, Role } from '@prisma/client'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { formatAmount, STATUS_LABELS } from '@/lib/invoices'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const ctx = await getContext()
  if (ctx.role === Role.OPERATOR_ADMIN && !ctx.tenantId) redirect('/platform')
  const tenantId = ctx.tenantId as string

  // Weich gelöschte Rechnungen (Papierkorb) tauchen im Dashboard nicht auf
  const [total, byStatus, recent] = await Promise.all([
    prisma.invoice.count({ where: { tenantId, deletedAt: null } }),
    prisma.invoice.groupBy({ by: ['status'], where: { tenantId, deletedAt: null }, _count: true }),
    prisma.invoice.findMany({ where: { tenantId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 8 }),
  ])
  const count = (s: InvoiceStatus) => byStatus.find((b) => b.status === s)?._count ?? 0

  const cards: { label: string; value: number; href: string }[] = [
    { label: 'Rechnungen gesamt', value: total, href: '/invoices' },
    { label: 'Neu', value: count(InvoiceStatus.NEW), href: '/invoices?status=NEW' },
    { label: 'Geprüft', value: count(InvoiceStatus.CHECKED), href: '/invoices?status=CHECKED' },
    { label: 'Exportiert', value: count(InvoiceStatus.EXPORTED), href: '/invoices?status=EXPORTED' },
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="dp-card-sm block hover:border-[var(--accent-border)]">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{c.label}</p>
            <p className="mt-1 font-serif text-3xl font-semibold text-[var(--accent)]">{c.value}</p>
          </Link>
        ))}
      </div>

      <section className="dp-card p-0">
        <div className="flex items-center justify-between px-6 pb-2 pt-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Zuletzt erfasst</h2>
          <div className="flex gap-2">
            <Link href="/invoices/new" className="btn-primary">Rechnung hinzufügen</Link>
            <Link href="/invoices/new/scan" className="btn-secondary">Papierrechnung scannen</Link>
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
