// Zentrale App-Konfiguration — Produktname NIE hardcoden (DP-Standard §3)
export const APP_NAME = process.env.APP_NAME ?? 'E-Invoice'
export const APP_NAME_SHORT = process.env.APP_NAME_SHORT ?? 'E-Invoice'
export const APP_COMPANY = process.env.APP_COMPANY ?? 'deltaplus GmbH'
// Wird an jedem Entwicklungstag automatisch um 0.0.1 erhöht
// (scripts/version-bump-daily.mjs, läuft via "predev"/"prebuild").
export const APP_VERSION = '0.5.1'
export const COPYRIGHT = `© 2026/2026 Delta Plus Systemhaus GmbH – EDV Lösungen`
