// Rechnungsliste mit Suche, Statusfilter und CSV-Export
import { InvoiceStatus, Prisma } from '@prisma/client'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileLink } from '@/components/crypto/FileLink'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { formatAmount, STATUS_LABELS } from '@/lib/invoices'

export const dynamic = 'force-dynamic'

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; dup?: string }
}) {
  const ctx = await getContext()
  if (!ctx.tenantId) redirect('/platform')
  const q = searchParams.q ?? ''
  const status = Object.values(InvoiceStatus).includes(searchParams.status as InvoiceStatus)
    ? (searchParams.status as InvoiceStatus)
    : undefined

  const hideDuplicates = searchParams.dup === 'hide'
  const where: Prisma.InvoiceWhereInput = {
    tenantId: ctx.tenantId,
    ...(hideDuplicates ? { duplicateOfId: null } : {}),
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
  }
  const invoices = await prisma.invoice.findMany({
    where,
    orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  })

  const exportUrl = `/api/invoices/export?q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}`

  return (
    <div className="space-y-4">
      <form className="dp-card flex flex-wrap items-end gap-3" method="get">
        <div className="min-w-[220px] flex-1">
          <label className="dp-label" htmlFor="q">Suche (Lieferant, Nummer, Tags)</label>
          <input id="q" name="q" className="dp-input mt-1" defaultValue={q} />
        </div>
        <div>
          <label className="dp-label" htmlFor="status">Status</label>
          <select id="status" name="status" className="dp-input mt-1" defaultValue={status ?? ''}>
            <option value="">Alle</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-700">
          <input type="checkbox" name="dup" value="hide" defaultChecked={hideDuplicates} />
          Dubletten ausblenden
        </label>
        <button className="btn-secondary" type="submit">Filtern</button>
        <a className="btn-secondary" href={exportUrl}>CSV-Export</a>
        <Link className="btn-primary" href="/invoices/new">Elektronische Rechnung hinzufügen</Link>
        <Link className="btn-secondary" href="/invoices/new/scan">Papierrechnung scannen</Link>
      </form>

      <div className="dp-card overflow-x-auto p-0">
        <table className="w-full min-w-[1020px]">
          <thead>
            <tr className="dp-tr">
              <th className="dp-th">Lieferant</th>
              <th className="dp-th">Nummer</th>
              <th className="dp-th">Datum</th>
              <th className="dp-th">Fällig</th>
              <th className="dp-th">Eingang</th>
              <th className="dp-th">Netto</th>
              <th className="dp-th">Brutto</th>
              <th className="dp-th">Status</th>
              <th className="dp-th">Inhalt</th>
              <th className="dp-th">Beleg</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="dp-tr">
                <td className="dp-td">
                  <Link className="font-medium text-[var(--accent)] hover:underline" href={`/invoices/${i.id}`}>
                    {i.vendor}
                  </Link>
                  {i.duplicateOfId && (
                    <span className="ml-1.5 rounded-full bg-[var(--warn-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warn-strong)]">
                      Dublette
                    </span>
                  )}
                  {i.tags && <p className="text-[10px] text-gray-400">{i.tags}</p>}
                </td>
                <td className="dp-td font-mono text-xs">{i.invoiceNumber ?? '—'}</td>
                <td className="dp-td text-xs">{i.invoiceDate ? format(i.invoiceDate, 'dd.MM.yyyy', { locale: de }) : '—'}</td>
                <td className="dp-td text-xs">{i.dueDate ? format(i.dueDate, 'dd.MM.yyyy', { locale: de }) : '—'}</td>
                <td className="dp-td whitespace-nowrap text-xs" title="Eingang in E-Invoice">
                  {format(i.createdAt, 'dd.MM.yyyy HH:mm', { locale: de })}
                </td>
                <td className="dp-td">{formatAmount(i.amountNet ? Number(i.amountNet) : null, i.currency)}</td>
                <td className="dp-td">{formatAmount(i.amountGross ? Number(i.amountGross) : null, i.currency)}</td>
                <td className="dp-td">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    i.status === 'REJECTED'
                      ? 'bg-red-50 text-[var(--danger)]'
                      : i.status === 'NEW'
                        ? 'bg-[var(--warn-bg)] text-[var(--warn-strong)]'
                        : 'bg-[var(--accent-bg)] text-[var(--accent)]'
                  }`}>{STATUS_LABELS[i.status]}</span>
                </td>
                <td className="dp-td">
                  {i.docFormat === 'ZUGFERD' || i.docFormat?.startsWith('XRECHNUNG') ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        i.validationOk === false
                          ? 'bg-red-50 text-[var(--danger)]'
                          : 'bg-[var(--accent-bg)] text-[var(--accent)]'
                      }`}
                      title={i.validationIssues ? `Fehlend: ${i.validationIssues}` : 'Pflichtangaben vollständig'}
                    >
                      {i.docFormat === 'ZUGFERD' ? 'ZUGFeRD' : 'XRechnung'}
                      {i.validationOk === false ? ' ✗' : i.validationOk ? ' ✓' : ''}
                    </span>
                  ) : i.encrypted ? (
                    <span className="text-[10px] text-gray-400" title="Inhalt verschlüsselt — nur der Kunde kann ihn lesen">🔒</span>
                  ) : i.fileName ? (
                    <span className="text-[10px] text-gray-400">nur PDF</span>
                  ) : (
                    <span className="text-[10px] text-gray-400">—</span>
                  )}
                </td>
                <td className="dp-td text-xs">
                  {i.fileName ? (
                    <FileLink invoiceId={i.id} encrypted={i.encrypted} origMime={i.encOrigMime} />
                  ) : '—'}
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr><td className="dp-td py-8 text-center text-gray-400" colSpan={10}>Keine Rechnungen gefunden.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
