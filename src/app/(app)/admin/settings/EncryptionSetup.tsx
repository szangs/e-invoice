'use client'

// Einrichtung der Ende-zu-Ende-Verschlüsselung (Zero-Knowledge):
// Datenschlüssel wird IM BROWSER erzeugt, mit der Passphrase verpackt und nur
// verpackt an den Server gegeben. Passphrase-Wechsel ohne Umschlüsselung der Dateien.
import { useEffect, useState } from 'react'
import { deriveKek, generateDekRaw, randomSaltB64, unwrapDek, wrapDek } from '@/lib/clientCrypto'
import { cacheDekRaw, fetchEncConfig, type EncConfig } from '@/lib/keyStore'

export function EncryptionSetup() {
  const [cfg, setCfg] = useState<EncConfig | null>(null)
  const [pass1, setPass1] = useState('')
  const [pass2, setPass2] = useState('')
  const [oldPass, setOldPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    fetchEncConfig().then(setCfg).catch(() => setErr('Konfiguration nicht ladbar.'))
  }, [])

  if (!cfg) return null

  async function enable(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setMsg('')
    if (pass1.length < 10) return setErr('Passphrase bitte mit mindestens 10 Zeichen.')
    if (pass1 !== pass2) return setErr('Die Passphrasen stimmen nicht überein.')
    setBusy(true)
    try {
      const salt = randomSaltB64()
      const dekRaw = generateDekRaw()
      const kek = await deriveKek(pass1, salt)
      const wrappedDek = await wrapDek(kek, dekRaw)
      const res = await fetch('/api/tenant/encryption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salt, wrappedDek }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setErr(d.error ?? 'Aktivierung fehlgeschlagen.')
        return
      }
      cacheDekRaw(dekRaw)
      setCfg({ enabled: true, salt, wrappedDek })
      setMsg('Verschlüsselung aktiviert. Neue Belege werden ab jetzt im Browser verschlüsselt.')
      setPass1('')
      setPass2('')
    } finally {
      setBusy(false)
    }
  }

  async function rekey(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setMsg('')
    if (pass1.length < 10) return setErr('Neue Passphrase bitte mit mindestens 10 Zeichen.')
    if (pass1 !== pass2) return setErr('Die neuen Passphrasen stimmen nicht überein.')
    setBusy(true)
    try {
      const kekOld = await deriveKek(oldPass, cfg!.salt as string)
      let dekRaw: Uint8Array
      try {
        dekRaw = await unwrapDek(kekOld, cfg!.wrappedDek as string)
      } catch {
        setErr('Aktuelle Passphrase ist falsch.')
        return
      }
      const salt = randomSaltB64()
      const kekNew = await deriveKek(pass1, salt)
      const wrappedDek = await wrapDek(kekNew, dekRaw)
      const res = await fetch('/api/tenant/encryption', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salt, wrappedDek }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setErr(d.error ?? 'Änderung fehlgeschlagen.')
        return
      }
      cacheDekRaw(dekRaw)
      setCfg({ enabled: true, salt, wrappedDek })
      setMsg('Passphrase geändert — bestehende Belege bleiben ohne Umschlüsselung lesbar.')
      setOldPass('')
      setPass1('')
      setPass2('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dp-card space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
        Beleg-Verschlüsselung (Schlüssel nur bei Ihnen)
      </h2>
      <p className="text-xs text-gray-500">
        Belege werden in Ihrem Browser mit AES-256 verschlüsselt, bevor sie den Server erreichen.
        Weder der Betreiber noch der Server können sie lesen. Workflow-Daten (Beträge, Lieferant,
        Status) bleiben unverschlüsselt und durchsuchbar.
      </p>
      <div className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] p-3 text-xs text-[var(--warn-strong)]">
        <strong>Wichtig:</strong> Geht die Passphrase verloren, sind die verschlüsselten Belege
        unwiederbringlich verloren. Es gibt keinen Wiederherstellungsweg — auch nicht durch den
        Betreiber. Bewahren Sie die Passphrase sicher auf (z. B. Passwort-Manager).
      </div>

      {!cfg.enabled ? (
        <form onSubmit={enable} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="dp-label">Passphrase (min. 10 Zeichen)</label>
              <input type="password" className="dp-input mt-1" value={pass1}
                onChange={(e) => setPass1(e.target.value)} />
            </div>
            <div>
              <label className="dp-label">Passphrase wiederholen</label>
              <input type="password" className="dp-input mt-1" value={pass2}
                onChange={(e) => setPass2(e.target.value)} />
            </div>
          </div>
          {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
          {msg && <p className="text-sm text-[var(--accent)]">{msg}</p>}
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Richte ein …' : 'Verschlüsselung aktivieren'}
          </button>
        </form>
      ) : (
        <form onSubmit={rekey} className="space-y-3">
          <p className="text-sm font-semibold text-[var(--accent)]">Verschlüsselung ist aktiv.</p>
          <p className="dp-label">Passphrase ändern</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="dp-label">Aktuelle Passphrase</label>
              <input type="password" className="dp-input mt-1" value={oldPass}
                onChange={(e) => setOldPass(e.target.value)} />
            </div>
            <div>
              <label className="dp-label">Neue Passphrase</label>
              <input type="password" className="dp-input mt-1" value={pass1}
                onChange={(e) => setPass1(e.target.value)} />
            </div>
            <div>
              <label className="dp-label">Neue wiederholen</label>
              <input type="password" className="dp-input mt-1" value={pass2}
                onChange={(e) => setPass2(e.target.value)} />
            </div>
          </div>
          {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
          {msg && <p className="text-sm text-[var(--accent)]">{msg}</p>}
          <button className="btn-secondary" disabled={busy || !oldPass}>
            {busy ? 'Ändere …' : 'Passphrase ändern'}
          </button>
        </form>
      )}
    </section>
  )
}
