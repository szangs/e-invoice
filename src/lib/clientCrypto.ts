// Ende-zu-Ende-Verschlüsselung der Belege — läuft ausschließlich IM BROWSER (WebCrypto).
// Server sieht nur Chiffrat. AES-256-GCM, Schlüsselableitung PBKDF2-SHA256.
// Aufbau verschlüsselter Blobs: IV (12 Byte) + Chiffrat.

const PBKDF2_ITERATIONS = 310_000

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  bytes.forEach((b) => (s += String.fromCharCode(b)))
  return btoa(s)
}

function b64decode(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

export function randomSaltB64(): string {
  return b64encode(crypto.getRandomValues(new Uint8Array(16)))
}

/** KEK aus der Kunden-Passphrase ableiten (verlässt nie den Browser). */
export async function deriveKek(passphrase: string, saltB64: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: b64decode(saltB64) as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Neuen Datenschlüssel (DEK) erzeugen — als Rohbytes, um ihn verpacken zu können. */
export function generateDekRaw(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

export async function importDek(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as unknown as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

/** DEK mit dem KEK verpacken → Base64(IV + Chiffrat). */
export async function wrapDek(kek: CryptoKey, dekRaw: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    kek,
    dekRaw as unknown as BufferSource,
  )
  const out = new Uint8Array(12 + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), 12)
  return b64encode(out)
}

/** DEK entpacken — wirft bei falscher Passphrase (GCM-Authentifizierung schlägt fehl). */
export async function unwrapDek(kek: CryptoKey, wrappedB64: string): Promise<Uint8Array> {
  const data = b64decode(wrappedB64)
  const iv = data.slice(0, 12)
  const ct = data.slice(12)
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    kek,
    ct as unknown as BufferSource,
  )
  return new Uint8Array(raw)
}

export async function encryptBytes(dek: CryptoKey, data: ArrayBuffer): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, dek, data)
  const out = new Uint8Array(12 + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), 12)
  return out
}

export async function decryptBytes(dek: CryptoKey, blob: ArrayBuffer): Promise<ArrayBuffer> {
  const data = new Uint8Array(blob)
  const iv = data.slice(0, 12)
  const ct = data.slice(12)
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    dek,
    ct as unknown as BufferSource,
  )
}

export { b64encode, b64decode }
