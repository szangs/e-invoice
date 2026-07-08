'use client'

// Beleg-Vorschau für die Detailseite (Stefan 2026-07-09, #113): zeigt das
// Rechnungsbild — bei PDFs (auch ZUGFeRD) als eingebettetes PDF, bei Fotos/
// Scans als Bild — damit der Anwender die Werte bei Bedarf direkt neben den
// Eingabefeldern ablesen/übertragen kann. Löst InvoicePdfPreview.tsx ab,
// das nur ZUGFeRD-PDFs zeigte; reine Scans (kein E-Rechnungs-XML) hatten
// bisher gar kein Bild auf der Detailseite. Verschlüsselte Belege werden wie
// bisher erst im Browser entschlüsselt (Zero-Knowledge, Server sieht nie
// den Klartext/die Passphrase).
import { useEffect, useState } from 'react'
import { decryptBytes } from '@/lib/clientCrypto'
import { getCachedDek, unlockWithPassphrase } from '@/lib/keyStore'

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']

export function BelegPreview({
  invoiceId,
  encrypted,
  origMime,
  mimeType,
  originalName,
}: {
  invoiceId: string
  encrypted: boolean
  origMime: string | null
  mimeType: string | null
  originalName: string | null
}) {
  const url = `/api/invoices/${invoiceId}/file`
  const effectiveMime = origMime ?? mimeType
  const isPdf = effectiveMime === 'application/pdf'
  const isImage = IMAGE_MIMES.includes(effectiveMime ?? '')
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
    const blob = new Blob([plain], { type: effectiveMime ?? 'application/pdf' })
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
          <input type="password" className="dp-input" value={pass} autoFocus
            onChange={(e) => setPass(e.target.value)} placeholder="Passphrase" />
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

  if (isImage) {
    return (
      <div className="dp-card overflow-hidden !p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={originalName ?? 'Beleg'} className="w-full rounded object-contain" />
      </div>
    )
  }

  if (isPdf) {
    return (
      <div className="dp-card overflow-hidden !p-0">
        <iframe src={src} title="Rechnungsbild (PDF)" className="h-[75vh] w-full lg:h-[calc(100vh-220px)]" />
      </div>
    )
  }

  // Unbekannter/nicht darstellbarer Dateityp — kein Inline-Bild, aber
  // wenigstens ein Hinweis statt eines leeren Bereichs.
  return (
    <div className="dp-card py-8 text-center text-sm text-gray-400">
      Keine Inline-Vorschau für diesen Dateityp — über „Beleg öffnen" ansehen.
    </div>
  )
}
