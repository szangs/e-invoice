import { randomInt } from 'crypto'

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
const SPECIAL = '!#$%+?'

/** Erzeugt ein gut lesbares Startpasswort (ohne verwechselbare Zeichen). */
export function generatePassword(length = 12): string {
  let pw = ''
  for (let i = 0; i < length - 1; i++) pw += CHARS[randomInt(CHARS.length)]
  pw += SPECIAL[randomInt(SPECIAL.length)]
  return pw
}

/** Erzeugt einen global eindeutigen technischen Benutzernamen aus Slug + Zufall. */
export function generateUsername(base: string): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'user'
  return `${clean}-${randomInt(1000, 9999)}`
}

/**
 * Lesbarer Basis-Benutzername aus Vor-/Nachname (vorname.nachname) — OHNE
 * Mandanten-Bezug (Stefan 2026-07-08: der bisherige Mandanten-Slug-Präfix
 * wirkte wie ein hartcodiertes "demo-", weil sein Test-Mandant "demo" heißt;
 * das war aber der Mandanten-Slug, kein Präfix-Bug). Eindeutigkeit über alle
 * Mandanten hinweg wird vom Aufrufer per Nummern-Suffix sichergestellt
 * (siehe generateUniqueUsername in den API-Routen).
 */
export function usernameBaseFromName(firstName: string, lastName: string): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]/g, '')
  const base = [clean(firstName), clean(lastName)].filter(Boolean).join('.')
  return base || 'user'
}
