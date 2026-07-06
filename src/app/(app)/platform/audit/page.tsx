// Revisionssicheres Audit-Protokoll (§18) — Ansicht für den Betreiber
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default async function AuditPage({
  searchParams,
}: {
  searchParams: { page?: string }
}) {
  await getContext({ operator: true })
  const page = Math.max(1, Number(searchParams.page ?? 1))
  const pageSize = 50
  const [entries, total, tenants] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { id: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count(),
    prisma.tenant.findMany({ select: { id: true, name: true } }),
  ])
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]))
  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="dp-card overflow-x-auto p-0">
      <div className="flex items-center justify-between px-6 pb-2 pt-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
          Audit-Protokoll · {total} Einträge · Hash-Kette
        </h2>
        <p className="text-xs text-gray-400">Seite {page} / {pages}</p>
      </div>
      <table className="w-full min-w-[900px]">
        <thead>
          <tr className="dp-tr">
            <th className="dp-th">Zeit</th>
            <th className="dp-th">Aktion</th>
            <th className="dp-th">Mandant</th>
            <th className="dp-th">Akteur</th>
            <th className="dp-th">Details</th>
            <th className="dp-th">Hash</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="dp-tr">
              <td className="dp-td whitespace-nowrap font-mono text-xs">
                {format(e.createdAt, 'dd.MM.yyyy HH:mm:ss', { locale: de })}
              </td>
              <td className="dp-td">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  e.action.includes('FAILED') || e.action.includes('KILL')
                    ? 'bg-red-50 text-[var(--danger)]'
                    : 'bg-[var(--accent-bg)] text-[var(--accent)]'
                }`}>{e.action}</span>
              </td>
              <td className="dp-td text-xs">{e.tenantId ? tenantName.get(e.tenantId) ?? e.tenantId : '—'}</td>
              <td className="dp-td text-xs">{e.actorName}</td>
              <td className="dp-td max-w-md truncate text-xs" title={e.details ?? ''}>{e.details ?? '—'}</td>
              <td className="dp-td font-mono text-[10px] text-gray-400">{e.hash.slice(0, 12)}…</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr><td className="dp-td py-8 text-center text-gray-400" colSpan={6}>Keine Einträge.</td></tr>
          )}
        </tbody>
      </table>
      <div className="flex gap-2 px-6 py-4">
        {page > 1 && <a className="btn-secondary" href={`/platform/audit?page=${page - 1}`}>← Neuer</a>}
        {page < pages && <a className="btn-secondary" href={`/platform/audit?page=${page + 1}`}>Älter →</a>}
      </div>
    </div>
  )
}
