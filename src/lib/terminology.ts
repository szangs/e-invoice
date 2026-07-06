// Konfigurierbare Terminologie (DP-Standard §11.3) — Defaults im Code,
// Overrides kommen aus system_settings (Präfix TERM_). Einstellungs-UI folgt in Runde 2.
export type TermKey = 'invoice' | 'invoices' | 'vendor' | 'tenant' | 'tenants'

const DEFAULTS: Record<TermKey, string> = {
  invoice: 'Rechnung',
  invoices: 'Rechnungen',
  vendor: 'Lieferant',
  tenant: 'Mandant',
  tenants: 'Mandanten',
}

let overrides: Partial<Record<TermKey, string>> = {}

export function loadTerminology(values: Partial<Record<TermKey, string>>): void {
  overrides = values
}

export function term(key: TermKey): string {
  return overrides[key] ?? DEFAULTS[key] ?? key
}

export function allTerms(): Record<TermKey, { value: string; default: string }> {
  return Object.fromEntries(
    (Object.keys(DEFAULTS) as TermKey[]).map((k) => [k, { value: term(k), default: DEFAULTS[k] }]),
  ) as Record<TermKey, { value: string; default: string }>
}
