// Betreiber-Systemeinstellungen (§24) — zentraler Schlüssel/Wert-Speicher
import { prisma } from '@/lib/db'

export const SETTING_KEYS = [
  // Mail-Versand: Anbieter
  'MAIL_PROVIDER', // "SMTP" (Standard) | "SMTP_OAUTH2" (Office 365, OAuth2/XOAUTH2) | "GRAPH" (Microsoft Graph API)
  // Mail-Versand (SMTP, Benutzer/Passwort — MAIL_PROVIDER = "SMTP")
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE', // "1" = TLS
  'SMTP_USER',
  'SMTP_PASS', // wird in der UI maskiert
  'SMTP_FROM',
  // Microsoft 365 / Azure-AD-App-Registrierung DES BETREIBERS (für MAIL_PROVIDER
  // "SMTP_OAUTH2" und "GRAPH") — nur für System-Mail-Versand aus der eigenen Domain
  // des Betreibers. NICHT für den Mail-Eingang: dort braucht jeder Mandant seine
  // eigene App-Registrierung (Mandanten-Einstellungen), da Anwendungsberechtigungen
  // nur innerhalb des eigenen Azure-AD-Tenants gelten — der Betreiber kann mit seinen
  // Zugangsdaten nicht in die Postfächer fremder, unabhängiger Mandanten-Firmen.
  'MS_TENANT_ID',
  'MS_CLIENT_ID',
  'MS_CLIENT_SECRET', // wird in der UI maskiert
  'MS_SENDER_EMAIL', // sendendes Postfach (muss der App-Registrierung erlaubt sein)
  // Fernwartungs-Relay (§14B — Werte werden hier bereits gepflegt, Client folgt in Runde 2)
  'REMOTE_RELAY_URL',
  'REMOTE_RELAY_KEY',
  // KI-Anbieter (frei wählbar, §24/§19)
  'AI_PROVIDER',
  'AI_API_KEY',
  'AI_MODEL',
  'AI_BASE_URL',
  // Tokenverbrauch-Schätzung (Stefan 2026-08-25) — Summe der vom Anbieter
  // gemeldeten total_tokens je Aufruf (lib/aiExtract.ts), NUR eine grobe
  // Abschätzung: Modelle/Anbieter haben stark unterschiedliche Preise pro
  // Token, deshalb bewusst KEINE Kostenschätzung in Euro, nur die reine
  // Token-Zahl seit dem letzten Zurücksetzen.
  'AI_TOKENS_TOTAL',
  'AI_TOKENS_SINCE',
  // Schalter
  'WELCOME_MAIL_ENABLED', // "1" = automatischer Versand der Zugangsdaten
  'FEEDBACK_ENABLED',
  'DEV_MODE',
  // Betriebssteuerung (§9)
  'MAINTENANCE_LOCK', // "1" = Anmeldesperre für normale Nutzer
  'SERVICE_STATUS_TEXT',
  'SUPPORT_TIMEOUT_MIN', // globaler Zeitabschluss für Fernwartungs-Sitzungen (§9/§14)
  'SESSION_TIMEOUT_HOURS', // globale Sitzungsdauer für alle Anmeldungen (§5) — leer = 12h Standard
  // E-Mail-Eingang (Weiterleitungs-Modell, eigener SMTP-Empfänger — IMAP-Abruf am 2026-07-08 entfernt)
  'MAIL_IN_DOMAIN', // z. B. einvoice.deltaplus.de (Subdomain für Einlieferung)
  'MAIL_IN_PREFIX', // z. B. "rechnung-" → rechnung-<kurzname>@<domain>
  'MAIL_IN_ALLOWED_DOMAINS', // global: nur Absender dieser Domänen (kommagetrennt, leer = alle)
  // SMTP-Empfangs-Alternative: eigener SMTP-Server wartet auf weitergeleitete Mails
  'MAIL_SMTP_ENABLED', // "1" = SMTP-Empfänger aktiv (Prozess: npm run smtp)
  'MAIL_SMTP_PORT', // Standard 2525 (Produktion: 25 hinter Firewall/Relay)
  // Mail-Eingang per Microsoft Graph (Alternative zum SMTP-Empfänger, Variante A):
  // NUR der globale Ein/Aus-Schalter + Poll-Intervall für den Abrufprozess. Die
  // Azure-Zugangsdaten (Tenant-ID/Client-ID/Client-Secret) trägt jeder Mandant
  // selbst ein (Tenant.mailInGraphTenantId/-ClientId/-ClientSecret) — die
  // Betreiber-Zugangsdaten oben (MS_TENANT_ID etc.) gelten nur für den eigenen
  // Azure-AD-Tenant des Betreibers und können fremde Mandanten-Postfächer nicht lesen.
  'MAIL_IN_GRAPH_ENABLED', // "1" = Graph-Poller aktiv (Prozess: npm run mailin-graph)
  'MAIL_IN_GRAPH_POLL_SECONDS', // Poll-Intervall, Standard 120
  // Kein eigener Test-Schalter: im bestehenden Entwicklungsmodus (DEV_MODE unten,
  // §24) fallen Mandanten ohne eigene Graph-Zugangsdaten auf die Betreiber-
  // Zugangsdaten zurück, statt übersprungen zu werden (siehe graphMailin.ts) —
  // funktioniert nur für Postfächer im EIGENEN Azure-AD-Tenant des Betreibers.
  // Mail-Eingang per POP3/IMAP (Stefan 2026-08-27) — global nur An/Aus + Poll-
  // Intervall wie bei Graph; Postfach-Zugangsdaten trägt jeder Mandant selbst
  // ein (Tenant.mailInPop3*/mailInImap*), siehe lib/pop3Mailin.ts/imapMailin.ts.
  'MAIL_IN_POP3_ENABLED', // "1" = POP3-Poller aktiv (Prozess: npm run mailin-pop3)
  'MAIL_IN_POP3_POLL_SECONDS', // Poll-Intervall, Standard 300
  'MAIL_IN_IMAP_ENABLED', // "1" = IMAP-Poller aktiv (Prozess: npm run mailin-imap)
  'MAIL_IN_IMAP_POLL_SECONDS', // Poll-Intervall, Standard 180
  // Datensicherung Gesamtsystem (§17)
  'BACKUP_SYSTEM_ENABLED', // "1" = automatische System-Sicherung aktiv
  'BACKUP_SYSTEM_FREQ', // DAILY | WEEKLY | MONTHLY | YEARLY
  'BACKUP_TARGET_DIR', // Sicherungsziel: Verzeichnis auf dem Server (auch Netzlaufwerk)
  'BACKUP_SYSTEM_EMAIL', // optional zusätzlich per E-Mail
  'BACKUP_SYSTEM_LAST', // letzte System-Sicherung (ISO, intern)
] as const

export type SettingKey = (typeof SETTING_KEYS)[number]

/** Schlüssel, deren Werte nie im Klartext an das Frontend gehen (nur Maske). */
export const SECRET_KEYS: SettingKey[] = ['SMTP_PASS', 'AI_API_KEY', 'REMOTE_RELAY_KEY', 'MS_CLIENT_SECRET']

export async function getSetting(key: SettingKey): Promise<string> {
  const row = await prisma.systemSetting.findUnique({ where: { key } })
  return row?.value ?? ''
}

export async function getSettings(): Promise<Record<SettingKey, string>> {
  const rows = await prisma.systemSetting.findMany()
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, map[k] ?? ''])) as Record<SettingKey, string>
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

/**
 * Zählt vom KI-Anbieter gemeldete Tokens auf (Stefan 2026-08-25, siehe
 * AI_TOKENS_TOTAL oben) — bewusst "best effort" per Lese-Schreib-Zyklus statt
 * einer atomaren DB-Operation: bei parallel laufenden Anfragen ist ein
 * kleiner Zählfehler für eine reine Abschätzung unkritisch.
 */
export async function addAiTokenUsage(tokens: number): Promise<void> {
  if (!Number.isFinite(tokens) || tokens <= 0) return
  const [totalRow, sinceRow] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: 'AI_TOKENS_TOTAL' } }),
    prisma.systemSetting.findUnique({ where: { key: 'AI_TOKENS_SINCE' } }),
  ])
  const newTotal = (Number(totalRow?.value) || 0) + tokens
  await setSetting('AI_TOKENS_TOTAL', String(newTotal))
  if (!sinceRow?.value) await setSetting('AI_TOKENS_SINCE', new Date().toISOString())
}

/** Maske für sensible Werte: erste/letzte 2 Zeichen sichtbar. */
export function mask(value: string): string {
  if (!value) return ''
  if (value.length <= 4) return '****'
  return `${value.slice(0, 2)}${'*'.repeat(Math.min(value.length - 4, 12))}${value.slice(-2)}`
}

/** Entwicklermodus: Schalter ODER Laufumgebung (Entwicklung ⇒ aktiv, §24). */
export async function isDevMode(): Promise<boolean> {
  if (process.env.NODE_ENV === 'development') return true
  return (await getSetting('DEV_MODE')) === '1'
}
