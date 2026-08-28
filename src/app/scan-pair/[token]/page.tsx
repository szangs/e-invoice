'use client'

// Handy-Seite der Kamera-Kopplung (Stefan 2026-08-27, "3D-Barcode + kleine
// App fürs Handy") — bewusst AUSSERHALB von (app), also ohne Login/AppShell
// erreichbar: das Handy meldet sich nie an, der Sitzungs-Token (in der URL)
// ist das einzige Berechtigungsmerkmal, siehe lib/scanSession.ts.
//
// Zero-Knowledge bei aktiver Verschlüsselung: der Schlüssel steckt NUR im
// URL-Fragment (#k=…), das der Browser nie an den Server schickt. Dieser
// Schlüssel ist ein sitzungseigener Einmal-Schlüssel (vom PC frisch
// erzeugt, KEIN Bezug zum echten Beleg-Datenschlüssel) — jedes Foto wird
// hier im Browser damit verschlüsselt, bevor es hochgeladen wird. Fehlt das
// Fragment (unverschlüsselter Mandant), wird unverändert hochgeladen.
import { useEffect, useRef, useState } from 'react'
import { encryptBytes, importDek } from '@/lib/clientCrypto'

type Status = 'loading' | 'ready' | 'invalid'

export default function ScanPairPage({ params }: { params: { token: string } }) {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [uploaded, setUploaded] = useState(0)
  const [busy, setBusy] = useState(false)
  const keyRef = useRef<CryptoKey | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Fragment sofort lesen und aus der sichtbaren URL entfernen (Stefan
    // 2026-08-27) — nicht aus Sicherheitsgründen nötig (der Server sieht das
    // Fragment ohnehin nie), aber damit der Schlüssel nicht z. B. in einem
    // Screenshot der Adressleiste oder im Verlauf sichtbar herumsteht.
    const hash = window.location.hash
    const m = /[#&]k=([^&]+)/.exec(hash)
    if (m) {
      const raw = Uint8Array.from(atob(decodeURIComponent(m[1])), (c) => c.charCodeAt(0))
      importDek(raw).then((k) => { keyRef.current = k })
      window.history.replaceState(null, '', window.location.pathname)
    }
    fetch(`/api/scan-sessions/${params.token}`)
      .then((r) => (r.ok ? setStatus('ready') : Promise.reject()))
      .catch(() => setStatus('invalid'))
  }, [params.token])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const buffer = await file.arrayBuffer()
      const fd = new FormData()
      if (keyRef.current) {
        const cipher = await encryptBytes(keyRef.current, buffer)
        fd.append('file', new Blob([cipher as unknown as BlobPart]))
        fd.append('encrypted', '1')
      } else {
        fd.append('file', file)
      }
      fd.append('mimeType', file.type || 'application/octet-stream')
      const res = await fetch(`/api/scan-sessions/${params.token}/photos`, { method: 'POST', body: fd })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Hochladen fehlgeschlagen.')
        if (res.status === 410) setStatus('invalid')
        return
      }
      setUploaded((n) => n + 1)
    } catch {
      setError('Hochladen fehlgeschlagen — Verbindung prüfen und erneut versuchen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 p-4 pt-10 text-center">
      <h1 className="text-lg font-semibold text-gray-900">📷 Handy-Scan</h1>

      {status === 'loading' && <p className="text-sm text-gray-500">Sitzung wird geprüft …</p>}

      {status === 'invalid' && (
        <p className="dp-card text-sm text-[var(--danger)]">
          Diese Sitzung ist abgelaufen oder wurde bereits beendet. Bitte am PC einen neuen Code
          erzeugen und erneut scannen.
        </p>
      )}

      {status === 'ready' && (
        <div className="dp-card space-y-4">
          <p className="text-sm text-gray-600">
            Mit dem Knopf unten ein Foto pro Rechnungsseite aufnehmen — jedes Foto erscheint sofort
            am PC.{keyRef.current && ' Die Übertragung ist verschlüsselt.'}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onFile}
          />
          <button
            type="button"
            className="btn-primary w-full"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Wird hochgeladen …' : '📷 Foto aufnehmen'}
          </button>
          {uploaded > 0 && (
            <p className="text-sm font-medium text-[var(--accent)]">
              ✓ {uploaded} Foto{uploaded === 1 ? '' : 's'} hochgeladen — weiter geht's am PC.
            </p>
          )}
          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        </div>
      )}
    </div>
  )
}
