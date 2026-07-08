// Schnellcodes & Navigation — einzige Quelle der Wahrheit (DP-Standard §11.1)
export type NavItem = { href: string; label: string; code: string; badge?: string; tenantOnly?: boolean; hint?: string }
export type NavGroup = {
  title: string
  items: NavItem[]
  operatorOnly?: boolean
  adminOnly?: boolean
  tenantOnly?: boolean // nur mit Mandanten-Kontext sinnvoll — für den Betreiber ausgeblendet
  /** Nur Mandanten-Administrator UND die Rolle "Prüfer" (Auditor) — enger als adminOnly. */
  auditOnly?: boolean
  hint?: string
}

export const DASHBOARD: NavItem = {
  href: '/dashboard', label: 'Dashboard', code: 'DB01',
  hint: 'Überblick: offene Rechnungen, Fälligkeiten, letzte Aktivität',
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Rechnungen',
    tenantOnly: true,
    hint: 'Rechnungserfassung, -prüfung und E-Mail-Eingang',
    items: [
      {
        href: '/invoices', label: 'Ablagekörbe', code: 'RE01',
        hint: 'Rechnungen je Korb — suchen, filtern, sortieren, verschieben, Papierkorb',
      },
      // RE02 (Rechnung erfassen) bewusst ohne Menüpunkt — erreichbar über die
      // Knöpfe in den Ablagekörben und im Dashboard: RE02a "Elektronische
      // Rechnung hinzufügen" (/invoices/new) und RE02b "Papierrechnung
      // scannen" (/invoices/new/scan)
      {
        href: '/mailin', label: 'E-Mail-Eingang', code: 'RE03',
        hint: 'Einlieferungs-Adresse und Verlauf automatisch eingegangener Rechnungen',
      },
    ],
  },
  {
    title: 'Verwaltung',
    adminOnly: true,
    hint: 'Benutzer, Körbe und Mandanten-Einstellungen',
    items: [
      { href: '/admin/users', label: 'Benutzer', code: 'BN01', hint: 'Mitarbeiter anlegen, Rollen vergeben, sperren' },
      {
        href: '/admin/baskets', label: 'Körbe', code: 'KO01',
        hint: 'Körbe anlegen, Mitarbeiter zuordnen, Vier-Augen-Prinzip und Benachrichtigung einstellen',
      },
      {
        href: '/admin/settings', label: 'Mandanten-Einstellungen', code: 'MA01',
        hint: 'KI-Nutzung, Verschlüsselung, Sicherung, Bericht, erlaubte Mail-Domänen',
      },
    ],
  },
  {
    title: 'Prüfung',
    tenantOnly: true,
    auditOnly: true,
    hint: 'Revisionssicheres Protokoll aller Aktionen in Ihrem Mandanten',
    items: [
      {
        href: '/audit', label: 'Audit-Protokoll', code: 'AU02',
        hint: 'Hash-verkettetes, nicht änderbares Protokoll — durchsuchbar nach Aktion, Akteur und Details',
      },
    ],
  },
  {
    title: 'Plattform',
    operatorOnly: true,
    hint: 'Betreiber-Funktionen über alle Mandanten hinweg',
    items: [
      { href: '/platform', label: 'Betreiber-Cockpit', code: 'PL01', hint: 'System-Kennzahlen — keine Rechnungsdaten der Mandanten' },
      { href: '/platform/tenants/new', label: 'Mandant anlegen', code: 'PL02', hint: 'Neuen Mandanten (Kunden) einrichten' },
      { href: '/platform/users', label: 'Benutzer (alle Mandanten)', code: 'PL03', hint: 'Mandantenübergreifende Benutzerverwaltung' },
      { href: '/platform/settings', label: 'Systemeinstellungen', code: 'SP01', hint: 'Globale KI-, Mail- und Sicherungs-Konfiguration' },
      { href: '/platform/audit', label: 'Audit-Protokoll', code: 'AU01', hint: 'Revisionssicheres, hash-verkettetes Protokoll aller Aktionen' },
    ],
  },
  {
    title: 'Hilfe',
    items: [
      { href: '/support', label: 'Support & Fernwartung', code: 'SU01', tenantOnly: true, hint: 'Fernwartungssitzung mit dem Betreiber starten' },
      { href: '/help', label: 'Hilfe & Nutzungsbedingungen', code: 'HE01', hint: 'Bedienungshilfe und rechtliche Hinweise' },
    ],
  },
]

export const ALL_NAV_ITEMS: NavItem[] = [DASHBOARD, ...NAV_GROUPS.flatMap((g) => g.items)]

export function findByCode(code: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((i) => i.code.toUpperCase() === code.toUpperCase())
}
