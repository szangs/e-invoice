'use client'

// PDF-Vorschau für ZUGFeRD/Factur-X: zeigt die eingereichte PDF-Datei selbst als
// Rechnungsbild an (statt nur die aus dem eingebetteten XML rekonstruierten Felder).
// Verschlüsselte Belege werden — wie beim Download über FileLink — erst im Browser
// entschlüsselt; der Server bekommt die Passphrase nie zu sehen (Zero-Knowledge).
import { useEffect, useState } from 'react'
import { decryptBytes } from '@/lib/clientCrypto'
import { getCachedDek, unlockWithPassphrase } from '@/lib/keyStore'

export function InvoicePdfPreview({
  invoiceId,
  encrypted,
  origMime,
}: {
  invoiceId: string
  encrypted: boolean
  origMime: string | null
}) {
  const url = `/api/invoices/${invoiceId}/file`
  const [src, setSrc] = useState<string | null>(encrypted ? null : url)
  const [prompting, setPrompting] = useState(false)
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function loadWithDek(dek: CryptoKey) {
    const res = await fetch(url)
    if (!res.ok) throw new Error('Beleg konnte nicht geladen werden.')
    const cipher = await res.arrayBuffer()
    const plain = await decryptBytes(dek, cipher)
    const blob = new Blob([plain], { type: origMime ?? 'application/pdf' })
    setSrc(URL.createObjectURL(blob))
  }

  useEffect(() => {
    if (!encrypted) return
    let cancelled = false
    ;(async () => {
      setBusy(true)
      try {
        const dek = await getCachedDek()
        if (!dek) {
          if (!cancelled) setPrompting(true)
          return
        }
        await loadWithDek(dek)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Entschlüsselung fehlgeschlagen.')
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encrypted, url])

  // Blob-URL wieder freigeben, sobald sie nicht mehr gebraucht wird
  useEffect(() => {
    return () => {
      if (src && src.startsWith('blob:')) URL.revokeObjectURL(src)
    }
  }, [src])

  async function onUnlock(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const dek = await unlockWithPassphrase(pass)
      setPrompting(false)
      setPass('')
      await loadWithDek(dek)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passphrase falsch.')
    } finally {
      setBusy(false)
    }
  }

  if (prompting) {
    return (
      <div className="dp-card flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm text-gray-600">
          Beleg ist verschlüsselt — Passphrase nötig, um das Rechnungsbild anzuzeigen.
        </p>
        <form onSubmit={onUnlock} className="flex items-center gap-2">
          <input
            type="password"
            className="dp-input"
            value={pass}
            autoFocus
            onChange={(e) => setPass(e.target.value)}
            placeholder="Passphrase"
          />
          <button type="submit" className="btn-primary" disabled={busy || !pass}>
            {busy ? 'Entschlüssle …' : 'Anzeigen'}
          </button>
        </form>
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      </div>
    )
  }

  if (!src) {
    return (
      <div className="dp-card py-8 text-center text-sm text-gray-400">
        {busy ? 'Lade Vorschau …' : error || 'Vorschau nicht verfügbar.'}
      </div>
    )
  }

  return (
    <div className="dp-card overflow-hidden !p-0">
      <iframe src={src} title="Rechnungsbild (PDF)" className="h-[75vh] w-full" />
    </div>
  )
}
