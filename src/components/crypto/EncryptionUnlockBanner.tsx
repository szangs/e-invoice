'use client'

// Inhalts-Verschlüsselung (Stefan 2026-07-09): EIN Banner statt einer
// Passphrase-Abfrage pro Zeile — nach einmaligem Entsperren bekommt jede
// InvoiceVendorCell/InvoiceNumberCell/InvoiceAmountCell auf der Seite über
// das "einvoice:dek-unlocked"-Event Bescheid und entschlüsselt sich selbst
// nach (siehe useDecryptedContent.ts). Schlüssel bleibt im Browser
// (sessionStorage), wird nie an den Server gesendet.
import { useState } from 'react'
import { unlockWithPassphrase } from '@/lib/keyStore'
import { notifyDekUnlocked } from './useDecryptedContent'

export function EncryptionUnlockBanner() {
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unlocked, setUnlocked] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await unlockWithPassphrase(pass)
      setPass('')
      setUnlocked(true)
      notifyDekUnlocked()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passphrase falsch.')
    } finally {
      setBusy(false)
    }
  }

  if (unlocked) return null

  return (
    <form onSubmit={onSubmit} className="dp-card flex flex-wrap items-center gap-2 !py-3">
      <span className="text-[11px] font-medium text-[var(--accent)]">
        🔒 Verschlüsselte Rechnungsinhalte — Passphrase eingeben, um Lieferant, Beträge etc. in
        dieser Liste lesbar zu machen (bleibt im Browser, wird nie an den Server gesendet).
      </span>
      <input type="password" className="dp-input !w-auto flex-1" value={pass} autoFocus
        onChange={(e) => setPass(e.target.value)} placeholder="Passphrase" />
      <button type="submit" className="btn-secondary" disabled={busy || !pass}>
        {busy ? 'Entsperre …' : 'Entsperren'}
      </button>
      {error && <span className="w-full text-xs text-[var(--danger)]">{error}</span>}
    </form>
  )
}
