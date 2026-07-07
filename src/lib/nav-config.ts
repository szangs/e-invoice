// Schnellcodes & Navigation — einzige Quelle der Wahrheit (DP-Standard §11.1)
export type NavItem = { href: string; label: string; code: string; badge?: string; tenantOnly?: boolean }
export type NavGroup = {
  title: string
  items: NavItem[]
  operatorOnly?: boolean
  adminOnly?: boolean
  tenantOnly?: boolean // nur mit Mandanten-Kontext sinnvoll — für den Betreiber ausgeblendet
}

export const DASHBOARD: NavItem = { href: '/dashboard', label: 'Dashboard', code: 'DB01' }

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Rechnungen',
    tenantOnly: true,
    items: [
      { href: '/invoices', label: 'Rechnungsliste', code: 'RE01' },
      // RE02 (Rechnung erfassen) bewusst ohne Menüpunkt — erreichbar über die
      // Knöpfe in Rechnungsliste und Dashboard: RE02a "Elektronische Rechnung
      // hinzufügen" (/invoices/new) und RE02b "Papierrechnung scannen"
      // (/invoices/new/scan)
      { href: '/mailin', label: 'E-Mail-Eingang', code: 'RE03' },
    ],
  },
  {
    title: 'Verwaltung',
    adminOnly: true,
    items: [
      { href: '/admin/users', label: 'Benutzer', code: 'BN01' },
      { href: '/admin/baskets', label: 'Körbe', code: 'KO01' },
      { href: '/admin/settings', label: 'Mandanten-Einstellungen', code: 'MA01' },
    ],
  },
  {
    title: 'Plattform',
    operatorOnly: true,
    items: [
      { href: '/platform', label: 'Betreiber-Cockpit', code: 'PL01' },
      { href: '/platform/tenants/new', label: 'Mandant anlegen', code: 'PL02' },
      { href: '/platform/users', label: 'Benutzer (alle Mandanten)', code: 'PL03' },
      { href: '/platform/settings', label: 'Systemeinstellungen', code: 'SP01' },
      { href: '/platform/audit', label: 'Audit-Protokoll', code: 'AU01' },
    ],
  },
  {
    title: 'Hilfe',
    items: [
      { href: '/support', label: 'Support & Fernwartung', code: 'SU01', tenantOnly: true },
      { href: '/help', label: 'Hilfe & Nutzungsbedingungen', code: 'HE01' },
    ],
  },
]

export const ALL_NAV_ITEMS: NavItem[] = [DASHBOARD, ...NAV_GROUPS.flatMap((g) => g.items)]

export function findByCode(code: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((i) => i.code.toUpperCase() === code.toUpperCase())
}
