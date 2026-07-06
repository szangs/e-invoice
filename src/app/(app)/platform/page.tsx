// Betreiber-Cockpit (§6) = Systemadmin-Dashboard: Kennzahlen, Betriebssteuerung,
// Fernwartung, Mandantenliste (ohne Einblick in Mandanten-Nutzdaten), Ereignisse.
import { SupportStatus } from '@prisma/client'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import Link from 'next/link'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { OpsControls } from './OpsControls'
import { SupportOps } from './SupportOps'
import { TenantActions } from './TenantActions'

export const dynamic = 'force-dynamic'

const ONLINE_MS = 5 * 60_000

export default async function PlatformPage() {
  await getContext({ operator: true })
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [tenants, settings, recentEvents, supportSessions, failedLogins24h, onlineUsers] =
    await Promise.all([
      prisma.tenant.findMany({
        orderBy: { name: 'asc' },
        include: { users: { select: { lastSeenAt: true } }, _count: { select: { users: true } } },
      }),
      getSettings(),
      prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: 12 }),
      prisma.supportSession.findMany({
        where: { status: { in: [SupportStatus.REQUESTED, SupportStatus.ACTIVE] } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where: { action: 'LOGIN_FAILED', createdAt: { gte: since24h } } }),
      prisma.user.count({ where: { lastSeenAt: { gte: new Date(Date.now() - ONLINE_MS) } } }),
    ])
  const now = Date.now()
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]))

  const kpis = [
    { label: 'Mandanten', value: tenants.length, sub: `${tenants.filter((t) => t.active).length} aktiv` },
    { label: 'Nutzer online', value: onlineUsers, sub: 'letzte 5 Minuten' },
    { label: 'Fernwartung', value: supportSessions.length, sub: 'offen / aktiv' },
    { label: 'Fehlanmeldungen', value: failedLogins24h, sub: 'letzte 24 h' },
  ]

  return (
    <div className="space-y-6">
      {/* Systemadmin-Kennzahlen */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="dp-card-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k.label}</p>
            <p className="mt-1 font-serif text-3xl font-semibold text-[var(--accent)]">{k.value}</p>
            <p className="text-[11px] text-gray-400">{k.sub}</p>
          </div>
        ))}
      </div>

      <OpsControls
        maintenanceLock={settings.MAINTENANCE_LOCK === '1'}
        serviceStatusText={settings.SERVICE_STATUS_TEXT}
        supportTimeoutMin={settings.SUPPORT_TIMEOUT_MIN || '30'}
      />

      {/* Fernwartung §14A */}
      <section className="dp-card">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
          Fernwartung — Anfragen & aktive Sitzungen
        </h2>
        {supportSessions.length === 0 ? (
          <p className="text-sm text-gray-400">Keine offenen Fernwartungs-Anfragen.</p>
        ) : (
          <ul className="space-y-2">
            {supportSessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium text-gray-800">{tenantName.get(s.tenantId) ?? s.tenantId}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  s.status === 'ACTIVE'
                    ? 'bg-red-50 text-[var(--danger)]'
                    : 'bg-[var(--warn-bg)] text-[var(--warn-strong)]'
                }`}>
                  {s.status === 'ACTIVE' ? '● aktiv' : `angefragt (${s.initiatedBy === 'TENANT' ? 'vom Mandanten' : 'vom Betreiber — wartet auf Einwilligung'})`}
                </span>
                <span className="text-xs text-gray-400">
                  {format(s.createdAt, 'dd.MM. HH:mm', { locale: de })}
                </span>
                <SupportOps
                  sessionId={s.id}
                  status={s.status}
                  initiatedBy={s.initiatedBy}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Mandantenliste — bewusst OHNE Nutzdaten der Mandanten (keine Rechnungs-Einblicke) */}
      <section className="dp-card overflow-x-auto p-0">
        <div className="flex items-center justify-between px-6 pb-2 pt-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Mandanten</h2>
          <Link href="/platform/tenants/new" className="btn-primary">Mandant anlegen</Link>
        </div>
        <table className="w-full min-w-[860px]">
          <thead>
            <tr className="dp-tr">
              <th className="dp-th">Mandant</th>
              <th className="dp-th">Kurzname</th>
              <th className="dp-th">Status</th>
              <th className="dp-th">Online</th>
              <th className="dp-th">Benutzer</th>
              <th className="dp-th">Lizenz</th>
              <th className="dp-th">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => {
              const online = t.users.filter(
                (u) => u.lastSeenAt && now - u.lastSeenAt.getTime() < ONLINE_MS,
              ).length
              return (
                <tr key={t.id} className="dp-tr">
                  <td className="dp-td font-medium">{t.name}</td>
                  <td className="dp-td font-mono text-xs">{t.slug}</td>
                  <td className="dp-td">
                    {t.active ? (
                      <span className="rounded-full bg-[var(--accent-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--accent)]">aktiv</span>
                    ) : (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-[var(--danger)]">gesperrt</span>
                    )}
                  </td>
                  <td className="dp-td">{online > 0 ? `● ${online}` : '—'}</td>
                  <td className="dp-td">{t._count.users} / {t.maxUsers}</td>
                  <td className="dp-td text-xs">
                    {t.licensePlan ?? '—'}
                    {t.licenseExpiresAt
                      ? ` · bis ${format(t.licenseExpiresAt, 'dd.MM.yyyy', { locale: de })}`
                      : ' · unbegrenzt'}
                  </td>
                  <td className="dp-td">
                    <TenantActions tenantId={t.id} tenantName={t.name} active={t.active} />
                  </td>
                </tr>
              )
            })}
            {tenants.length === 0 && (
              <tr><td className="dp-td py-8 text-center text-gray-400" colSpan={7}>Noch keine Mandanten angelegt.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="dp-card">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Letzte Ereignisse</h2>
        <ul className="space-y-1.5">
          {recentEvents.map((e) => (
            <li key={e.id} className="flex items-baseline gap-2 text-sm">
              <span className="shrink-0 font-mono text-[10px] text-gray-400">
                {format(e.createdAt, 'dd.MM. HH:mm', { locale: de })}
              </span>
              <span className={`shrink-0 rounded px-1.5 text-[10px] font-semibold ${
                e.action.includes('FAILED') || e.action.includes('KILL')
                  ? 'bg-red-50 text-[var(--danger)]'
                  : 'bg-[var(--accent-bg)] text-[var(--accent)]'
              }`}>{e.action}</span>
              <span className="truncate text-gray-700">
                {e.tenantId ? `[${tenantName.get(e.tenantId) ?? '—'}] ` : ''}
                {e.actorName}{e.details ? ` — ${e.details}` : ''}
              </span>
            </li>
          ))}
          {recentEvents.length === 0 && <li className="text-sm text-gray-400">Keine Ereignisse.</li>}
        </ul>
        <Link href="/platform/audit" className="mt-3 inline-block text-xs text-[var(--accent)] underline">
          Vollständiges Audit-Protokoll (AU01)
        </Link>
      </section>
    </div>
  )
}
