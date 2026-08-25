// Revisionssicheres Audit-Protokoll (§18) — Ansicht für den Betreiber
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { PeriodClosurePanel, type PeriodRow } from './PeriodClosurePanel'

export const dynamic = 'force-dynamic'

export default async function AuditPage({
  searchParams,
}: {
  searchParams: { page?: string }
}) {
  await getContext({ operator: true })
  const page = Math.max(1, Number(searchParams.page ?? 1))
  const pageSize = 50
  const [entries, total, tenants, earliest, closures, countsByYearRaw] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { id: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count(),
    prisma.tenant.findMany({ select: { id: true, name: true } }),
    // Nach createdAt sortiert (nicht id) — ein nachträglich importierter/
    // rückdatierter Eintrag könnte sonst eine ältere Periode verstecken.
    prisma.auditLog.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    prisma.auditPeriodClosure.findMany({ orderBy: { year: 'desc' } }),
    prisma.$queryRaw<{ year: number; count: bigint }[]>`
      SELECT EXTRACT(YEAR FROM "createdAt")::int AS year, COUNT(*)::bigint AS count
      FROM "AuditLog" GROUP BY 1
    `,
  ])
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]))
  const pages = Math.max(1, Math.ceil(total / pageSize))

  // Perioden-Übersicht (Stefan 2026-08-25): vom ersten Audit-Eintrag bis zum
  // aktuellen (noch nicht abschließbaren) Jahr — "abschließbar" nur für
  // Jahre, die vollständig vergangen sind (siehe api/platform/audit/period-close).
  const closureByYear = new Map(closures.map((c) => [c.year, c]))
  const countByYear = new Map(countsByYearRaw.map((r) => [r.year, Number(r.count)]))
  const now = new Date()
  const currentYear = now.getFullYear()
  const earliestYear = earliest?.createdAt.getFullYear() ?? currentYear
  const years: PeriodRow[] = []
  for (let y = currentYear; y >= earliestYear; y--) {
    const closure = closureByYear.get(y)
    years.push({
      year: y,
      closed: Boolean(closure),
      closable: now >= new Date(y + 1, 0, 1),
      entryCount: countByYear.get(y) ?? 0,
      closedAt: closure?.closedAt.toISOString() ?? null,
      closedByName: closure?.closedByName ?? null,
    })
  }

  return (
    <div className="space-y-6">
      <PeriodClosurePanel years={years} />
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
              <td className="dp-td font-mono text-[10px] text-gray-400" title={e.hash}>{e.hash.slice(0, 12)}…</td>
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
    </div>
  )
}
