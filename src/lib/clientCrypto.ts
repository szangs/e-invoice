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

// Automatische Passphrase-Generierung (Stefan 2026-07-09, #102): "Beides
// anbieten" — Kunde kann weiter frei eine eigene Passphrase wählen ODER sich
// eine zufällige erzeugen lassen (gedacht zum Ausdrucken/Verwahren statt
// Merken, siehe Zertifikat-Druck in EncryptionSetup.tsx). Alphabet ohne
// leicht verwechselbare Zeichen (0/O, 1/I/L); 25 Zeichen aus 32-Zeichen-
// Alphabet ≈ 125 Bit Entropie, in 5er-Gruppen für bessere Lesbarkeit.
const PASSPHRASE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generatePassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(25))
  const chars = Array.from(bytes, (b) => PASSPHRASE_ALPHABET[b % PASSPHRASE_ALPHABET.length])
  const groups: string[] = []
  for (let i = 0; i < chars.length; i += 5) groups.push(chars.slice(i, i + 5).join(''))
  return groups.join('-')
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

/**
 * SHA-256 des KLARTEXTS (Hex) — für die Dubletten-Erkennung bei aktiver
 * Verschlüsselung. WICHTIG: AES-GCM verwendet pro Verschlüsselung ein neues
 * zufälliges IV, das Chiffrat ist also bei identischem Klartext nie gleich —
 * ein serverseitig über das Chiffrat gebildeter Hash kann Dubletten deshalb
 * nie erkennen. Der Hash hier wird VOR dem Verschlüsseln im Browser gebildet
 * und nur als Fingerabdruck mitgeschickt (kein Klartext-Inhalt) — mit dem
 * Zero-Knowledge-Prinzip vereinbar.
 */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Inhalts-Verschlüsselung (Stefan 2026-07-09): dieselbe DEK wie für die
 * Beleg-Datei, aber für die strukturierten Rechnungsfelder (Lieferant,
 * Beträge, Notizen, XML …) statt für die Datei-Bytes — ein JSON-Objekt wird
 * client-seitig zu einem einzigen AES-GCM-Chiffrat (Base64, IV+Ciphertext,
 * gleiches Format wie encryptBytes/decryptBytes). Server sieht auch hier nie
 * den Klartext, nur diesen einen Blob (Invoice.contentEnc).
 */
export async function encryptJson(dek: CryptoKey, value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const enc = await encryptBytes(dek, bytes.buffer as ArrayBuffer)
  return b64encode(enc)
}

export async function decryptJson<T = Record<string, unknown>>(dek: CryptoKey, blobB64: string): Promise<T> {
  const bytes = b64decode(blobB64)
  const plain = await decryptBytes(dek, bytes.buffer as ArrayBuffer)
  return JSON.parse(new TextDecoder().decode(plain)) as T
}

export { b64encode, b64decode }
