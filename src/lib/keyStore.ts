// Client-seitiger Schlüsselspeicher: hält den entpackten Datenschlüssel (DEK)
// für die Dauer der Browser-Sitzung (sessionStorage). Der Server sieht ihn nie.
import { b64decode, b64encode, deriveKek, importDek, unwrapDek } from '@/lib/clientCrypto'

const STORAGE_KEY = 'einvoice.dek'

export type EncConfig = { enabled: boolean; salt: string | null; wrappedDek: string | null; tenantName: string | null }

export async function fetchEncConfig(): Promise<EncConfig> {
  const res = await fetch('/api/tenant/encryption', { cache: 'no-store' })
  if (!res.ok) return { enabled: false, salt: null, wrappedDek: null, tenantName: null }
  return res.json()
}

export async function getCachedDek(): Promise<CryptoKey | null> {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return await importDek(b64decode(raw))
  } catch {
    sessionStorage.removeItem(STORAGE_KEY)
    return null
  }
}

/** Entsperrt mit der Kunden-Passphrase. Wirft Error bei falscher Passphrase. */
export async function unlockWithPassphrase(passphrase: string, cfg?: EncConfig): Promise<CryptoKey> {
  const config = cfg ?? (await fetchEncConfig())
  if (!config.enabled || !config.salt || !config.wrappedDek) {
    throw new Error('Verschlüsselung ist nicht eingerichtet.')
  }
  const kek = await deriveKek(passphrase, config.salt)
  let dekRaw: Uint8Array
  try {
    dekRaw = await unwrapDek(kek, config.wrappedDek)
  } catch {
    throw new Error('Passphrase ist falsch.')
  }
  sessionStorage.setItem(STORAGE_KEY, b64encode(dekRaw))
  return importDek(dekRaw)
}

export function lockKey(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}

/** Frisch erzeugten DEK direkt für diese Sitzung merken (nach dem Einrichten). */
export function cacheDekRaw(raw: Uint8Array): void {
  sessionStorage.setItem(STORAGE_KEY, b64encode(raw))
}
