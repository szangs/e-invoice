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
