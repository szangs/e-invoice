// Betreiber-Systemeinstellungen (§24) — zentraler Schlüssel/Wert-Speicher
import { prisma } from '@/lib/db'

export const SETTING_KEYS = [
  // Mail-Versand (SMTP)
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE', // "1" = TLS
  'SMTP_USER',
  'SMTP_PASS', // wird in der UI maskiert
  'SMTP_FROM',
  // Fernwartungs-Relay (§14B — Werte werden hier bereits gepflegt, Client folgt in Runde 2)
  'REMOTE_RELAY_URL',
  'REMOTE_RELAY_KEY',
  // KI-Anbieter (frei wählbar, §24/§19)
  'AI_PROVIDER',
  'AI_API_KEY',
  'AI_MODEL',
  'AI_BASE_URL',
  // Schalter
  'WELCOME_MAIL_ENABLED', // "1" = automatischer Versand der Zugangsdaten
  'FEEDBACK_ENABLED',
  'DEV_MODE',
  // Betriebssteuerung (§9)
  'MAINTENANCE_LOCK', // "1" = Anmeldesperre für normale Nutzer
  'SERVICE_STATUS_TEXT',
] as const

export type SettingKey = (typeof SETTING_KEYS)[number]

/** Schlüssel, deren Werte nie im Klartext an das Frontend gehen (nur Maske). */
export const SECRET_KEYS: SettingKey[] = ['SMTP_PASS', 'AI_API_KEY', 'REMOTE_RELAY_KEY']

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
