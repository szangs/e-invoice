// Revisionssicheres Audit-Protokoll — Mandanten-Ansicht (Stefan 2026-07-08):
// dieselbe Hash-Ketten-Tabelle wie /platform/audit, aber auf den eigenen
// Mandanten beschränkt und mit einfacher Volltextsuche (Aktion/Akteur/Details).
// Zugriff: Mandanten-Administrator + Rollen mit dem Rollen-Recht VIEW_AUDIT
// (Standard: Prüfer, siehe lib/roleActions.ts — dort in der Benutzerverwaltung
// pro Mandant editierbar) — der Betreiber sieht ohnehin alles unter /platform/audit.
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'
import { getContext, requireTenant } from '@/lib/context'
import { prisma } from '@/lib/db'
import { hasRoleAction } from '@/lib/roleActions'
import { MailinHistoryPanel } from './MailinHistoryPanel'
import { PeriodClosurePanel, type PeriodRow } from './PeriodClosurePanel'

export const dynamic = 'force-dynamic'

export default async function TenantAuditPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string }
}) {
  const ctx = await getContext()
  if (!ctx.tenantId) redirect('/platform')
  const tenantId = requireTenant(ctx)
  const tenantForRole = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { roleActions: true } })
  if (!hasRoleAction(tenantForRole, ctx.role, 'VIEW_AUDIT')) {
    redirect('/dashboard')
  }

  const q = (searchParams.q ?? '').trim()
  const page = Math.max(1, Number(searchParams.page ?? 1))
  const pageSize = 50

  const where = {
    tenantId,
    ...(q
      ? {
          OR: [
            { action: { contains: q, mode: 'insensitive' as const } },
            { actorName: { contains: q, mode: 'insensitive' as const } },
            { details: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ])
  const pages = Math.max(1, Math.ceil(total / pageSize))

  function pageHref(p: number): string {
    const params = new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })
    return `/audit?${params.toString()}`
  }

  // Perioden-Abschluss (Stefan 2026-08-27, "gehört zum Mandanten, nicht ins
  // Betreiber-Cockpit") — die destruktive, unumkehrbare Abschluss-Aktion
  // bleibt dem Mandanten-Administrator vorbehalten, auch wenn Prüfer
  // (VIEW_AUDIT) diese Seite selbst sehen dürfen.
  const isTenantAdmin = ctx.role === Role.TENANT_ADMIN
  let years: PeriodRow[] = []
  if (isTenantAdmin) {
    const [earliest, closures, countsByYearRaw] = await Promise.all([
      // Nach createdAt sortiert (nicht id) — ein nachträglich importierter/
      // rückdatierter Eintrag könnte sonst eine ältere Periode verstecken.
      prisma.auditLog.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      prisma.auditPeriodClosure.findMany({ where: { tenantId }, orderBy: { year: 'desc' } }),
      prisma.$queryRaw<{ year: number; count: bigint }[]>`
        SELECT EXTRACT(YEAR FROM "createdAt")::int AS year, COUNT(*)::bigint AS count
        FROM "AuditLog" WHERE "tenantId" = ${tenantId} GROUP BY 1
      `,
    ])
    const closureByYear = new Map(closures.map((c) => [c.year, c]))
    const countByYear = new Map(countsByYearRaw.map((r) => [r.year, Number(r.count)]))
    const now = new Date()
    const currentYear = now.getFullYear()
    const earliestYear = earliest?.createdAt.getFullYear() ?? currentYear
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
  }

  return (
    <div className="space-y-4">
      {isTenantAdmin && <PeriodClosurePanel years={years} />}
      <MailinHistoryPanel />

      <form className="dp-card flex flex-wrap items-end gap-3" method="get">
        <div className="min-w-[260px] flex-1">
          <label className="dp-label" htmlFor="q">Suche</label>
          <input
            id="q" name="q" defaultValue={q} className="dp-input mt-1"
            placeholder="Aktion, Akteur oder Details durchsuchen …"
            title="Durchsucht Aktion, Akteur und Details-Text (Groß-/Kleinschreibung egal)"
          />
        </div>
        <button type="submit" className="btn-primary" title="Suche anwenden">Suchen</button>
        {q && (
          <a href="/audit" className="btn-secondary" title="Suche zurücksetzen">Zurücksetzen</a>
        )}
      </form>

      <div className="dp-card overflow-x-auto p-0">
        <div className="flex items-center justify-between px-6 pb-2 pt-5">
          <h2
            className="text-sm font-bold uppercase tracking-wide text-gray-500"
            title="Revisionssicheres, hash-verkettetes Protokoll aller Aktionen in Ihrem Mandanten — nicht änderbar, nicht löschbar"
          >
            Audit-Protokoll · {total} Eintr{total === 1 ? 'ag' : 'äge'}{q ? ` (gefiltert)` : ''} · Hash-Kette
          </h2>
          <p className="text-xs text-gray-400">Seite {page} / {pages}</p>
        </div>
        {/* Höhe begrenzt + scrollbar (Stefan 2026-08-25) — bis zu 50 Einträge
            je Seite würden sonst sehr lang werden; Kopfzeile bleibt beim
            Scrollen innerhalb der Tabelle sichtbar. Seitenweise Blättern
            unten bleibt unverändert. */}
        <div className="max-h-96 overflow-y-auto">
        <table className="w-full min-w-[800px]">
          <thead className="sticky top-0 bg-[var(--surface)]">
            <tr className="dp-tr">
              <th className="dp-th">Zeit</th>
              <th className="dp-th">Aktion</th>
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
                    e.action.includes('FAILED') || e.action.includes('DELETE')
                      ? 'bg-red-50 text-[var(--danger)]'
                      : 'bg-[var(--accent-bg)] text-[var(--accent)]'
                  }`}>{e.action}</span>
                </td>
                <td className="dp-td text-xs">{e.actorName}</td>
                <td className="dp-td max-w-md truncate text-xs" title={e.details ?? ''}>{e.details ?? '—'}</td>
                <td className="dp-td font-mono text-[10px] text-gray-400">{e.hash.slice(0, 12)}…</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td className="dp-td py-8 text-center text-gray-400" colSpan={5}>
                {q ? 'Keine Treffer für diese Suche.' : 'Keine Einträge.'}
              </td></tr>
            )}
          </tbody>
        </table>
        </div>
        <div className="flex gap-2 px-6 py-4">
          {page > 1 && <a className="btn-secondary" href={pageHref(page - 1)}>← Neuer</a>}
          {page < pages && <a className="btn-secondary" href={pageHref(page + 1)}>Älter →</a>}
        </div>
      </div>
    </div>
  )
}
