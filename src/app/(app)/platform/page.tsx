// Betreiber-Cockpit (§6): Mandantenliste, Status, Online-Anzeige, Betriebssteuerung
import Link from 'next/link'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { OpsControls } from './OpsControls'
import { TenantActions } from './TenantActions'

export const dynamic = 'force-dynamic'

const ONLINE_MS = 5 * 60_000

export default async function PlatformPage() {
  await getContext({ operator: true })
  const [tenants, settings, recentEvents] = await Promise.all([
    prisma.tenant.findMany({
      orderBy: { name: 'asc' },
      include: { users: { select: { lastSeenAt: true } }, _count: { select: { users: true, invoices: true } } },
    }),
    getSettings(),
    prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: 12 }),
  ])
  const now = Date.now()

  return (
    <div className="space-y-6">
      <OpsControls
        maintenanceLock={settings.MAINTENANCE_LOCK === '1'}
        serviceStatusText={settings.SERVICE_STATUS_TEXT}
      />

      <section className="dp-card overflow-x-auto p-0">
        <div className="flex items-center justify-between px-6 pb-2 pt-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Mandanten</h2>
          <Link href="/platform/tenants/new" className="btn-primary">Mandant anlegen</Link>
        </div>
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="dp-tr">
              <th className="dp-th">Mandant</th>
              <th className="dp-th">Kurzname</th>
              <th className="dp-th">Status</th>
              <th className="dp-th">Online</th>
              <th className="dp-th">Benutzer</th>
              <th className="dp-th">Rechnungen</th>
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
                  <td className="dp-td">{t._count.invoices}</td>
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
              <tr><td className="dp-td py-8 text-center text-gray-400" colSpan={8}>Noch keine Mandanten angelegt.</td></tr>
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
              <span className="truncate text-gray-700">{e.actorName}{e.details ? ` — ${e.details}` : ''}</span>
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
