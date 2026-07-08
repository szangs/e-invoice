'use client'

// AppTopbar nach DP-Designsystem §4.7
import { Role } from '@prisma/client'
import { usePathname } from 'next/navigation'
import { ALL_NAV_ITEMS } from '@/lib/nav-config'

const ROLE_LABELS: Record<Role, string> = {
  OPERATOR_ADMIN: 'Betreiber',
  TENANT_ADMIN: 'Administrator',
  EDITOR: 'Bearbeiter',
  AREA_MANAGER: 'Bereichsleitung',
  AUDITOR: 'Prüfer',
  USER: 'Nutzer',
}

export function AppTopbar({
  tenantName,
  role,
  email,
  impersonatorName,
}: {
  tenantName: string | null
  role: Role
  email: string
  impersonatorName: string | null
}) {
  const pathname = usePathname()
  const current = ALL_NAV_ITEMS.find(
    (i) => pathname === i.href || pathname.startsWith(i.href + '/'),
  )
  const title = current?.label ?? 'E-Invoice'

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-[var(--line)] bg-[var(--surface-warm)]/80 px-4 backdrop-blur sm:px-6 print:hidden">
      <div className="flex min-w-0 items-center gap-3 pl-10 lg:pl-0">
        <h1 className="truncate text-lg font-semibold text-gray-900 sm:text-xl">{title}</h1>
        {current && <span className="text-[10px] font-mono text-gray-300">{current.code}</span>}
      </div>
      <div className="flex items-center gap-3">
        {impersonatorName && (
          <span className="rounded-full bg-[var(--warn-bg)] px-2.5 py-1 text-xs font-medium text-[var(--warn-strong)]"
            title="Diese Sitzung läuft als Impersonation — der Betreiber ist vorübergehend als dieser Nutzer angemeldet (§12)">
            Impersonation durch {impersonatorName}
          </span>
        )}
        <span className="hidden max-w-[200px] truncate text-sm font-medium text-gray-700 sm:block">
          {tenantName ?? 'Plattform'}
        </span>
        <span className="rounded-full bg-[var(--accent-bg)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]"
          title="Ihre Rolle in diesem Mandanten">
          {ROLE_LABELS[role]}
        </span>
        <span className="hidden text-xs text-gray-400 md:block">{email}</span>
      </div>
    </header>
  )
}
