// Zero-Knowledge-Krypto des Rechnungs-Catchers — identisch zur Web-App:
// AES-256-GCM, PBKDF2-SHA256 (310.000 Iterationen). Läuft NUR im Browser des Kunden.
const PBKDF2_ITERATIONS = 310000

export function b64encode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  bytes.forEach((b) => (s += String.fromCharCode(b)))
  return btoa(s)
}

export function b64decode(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

export async function deriveKek(passphrase, saltB64) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64decode(saltB64), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function unwrapDek(kek, wrappedB64) {
  const data = b64decode(wrappedB64)
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.slice(0, 12) },
    kek,
    data.slice(12),
  )
  return new Uint8Array(raw)
}

export async function importDek(raw) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptBytes(dek, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, data)
  const out = new Uint8Array(12 + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), 12)
  return out
}
