'use client'

// Öffnet Belege: unverschlüsselt direkt, verschlüsselt nach Entschlüsselung im Browser.
// Fragt bei Bedarf die Kunden-Passphrase ab (Schlüssel bleibt im Browser).
import { useState } from 'react'
import { decryptBytes } from '@/lib/clientCrypto'
import { getCachedDek, unlockWithPassphrase } from '@/lib/keyStore'

export function FileLink({
  invoiceId,
  encrypted,
  origMime,
  label = 'öffnen',
}: {
  invoiceId: string
  encrypted: boolean
  origMime: string | null
  label?: string
}) {
  const [prompting, setPrompting] = useState(false)
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const url = `/api/invoices/${invoiceId}/file`

  async function decryptAndOpen(dek: CryptoKey) {
    const res = await fetch(url)
    if (!res.ok) throw new Error('Beleg konnte nicht geladen werden.')
    const cipher = await res.arrayBuffer()
    const plain = await decryptBytes(dek, cipher)
    const blob = new Blob([plain], { type: origMime ?? 'application/pdf' })
    window.open(URL.createObjectURL(blob), '_blank')
  }

  async function onOpen() {
    setError('')
    if (!encrypted) {
      window.open(url, '_blank')
      return
    }
    setBusy(true)
    try {
      const dek = await getCachedDek()
      if (dek) {
        await decryptAndOpen(dek)
      } else {
        setPrompting(true)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Entschlüsselung fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  async function onUnlock(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const dek = await unlockWithPassphrase(pass)
      setPrompting(false)
      setPass('')
      await decryptAndOpen(dek)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passphrase falsch.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={onOpen} disabled={busy}
        className="text-[var(--accent)] underline disabled:opacity-50">
        {encrypted ? `🔒 ${label}` : label}
      </button>
      {error && !prompting && <span className="ml-1 text-[10px] text-[var(--danger)]">{error}</span>}
      {prompting && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPrompting(false)}>
          <form onSubmit={onUnlock} className="dp-card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-900">Beleg entschlüsseln</p>
            <p className="mt-1 text-xs text-gray-500">
              Bitte die Verschlüsselungs-Passphrase Ihres Unternehmens eingeben.
              Sie bleibt in Ihrem Browser und wird nie an den Server gesendet.
            </p>
            <input type="password" className="dp-input mt-3" value={pass} autoFocus
              onChange={(e) => setPass(e.target.value)} placeholder="Passphrase" />
            {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
            <div className="mt-3 flex gap-2">
              <button type="submit" className="btn-primary" disabled={busy || !pass}>
                {busy ? 'Entschlüssle …' : 'Entsperren & öffnen'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setPrompting(false)}>
                Abbrechen
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
