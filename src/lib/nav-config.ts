// Schnellcodes & Navigation — einzige Quelle der Wahrheit (DP-Standard §11.1)
export type NavItem = { href: string; label: string; code: string; badge?: string }
export type NavGroup = { title: string; items: NavItem[]; operatorOnly?: boolean; adminOnly?: boolean }

export const DASHBOARD: NavItem = { href: '/dashboard', label: 'Dashboard', code: 'DB01' }

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Rechnungen',
    items: [
      { href: '/invoices', label: 'Rechnungsliste', code: 'RE01' },
      { href: '/invoices/new', label: 'Rechnung erfassen', code: 'RE02' },
    ],
  },
  {
    title: 'Verwaltung',
    adminOnly: true,
    items: [
      { href: '/admin/users', label: 'Benutzer', code: 'BN01' },
      { href: '/admin/settings', label: 'Mandanten-Einstellungen', code: 'MA01' },
    ],
  },
  {
    title: 'Plattform',
    operatorOnly: true,
    items: [
      { href: '/platform', label: 'Betreiber-Cockpit', code: 'PL01' },
      { href: '/platform/tenants/new', label: 'Mandant anlegen', code: 'PL02' },
      { href: '/platform/settings', label: 'Systemeinstellungen', code: 'SP01' },
      { href: '/platform/audit', label: 'Audit-Protokoll', code: 'AU01' },
    ],
  },
  {
    title: 'Hilfe',
    items: [
      { href: '/support', label: 'Support & Fernwartung', code: 'SU01' },
      { href: '/help', label: 'Hilfe & Nutzungsbedingungen', code: 'HE01' },
    ],
  },
]

export const ALL_NAV_ITEMS: NavItem[] = [DASHBOARD, ...NAV_GROUPS.flatMap((g) => g.items)]

export function findByCode(code: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((i) => i.code.toUpperCase() === code.toUpperCase())
}
