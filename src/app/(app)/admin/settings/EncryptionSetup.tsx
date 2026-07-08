'use client'

// Einrichtung der Ende-zu-Ende-Verschlüsselung (Zero-Knowledge):
// Datenschlüssel wird IM BROWSER erzeugt, mit der Passphrase verpackt und nur
// verpackt an den Server gegeben. Passphrase-Wechsel ohne Umschlüsselung der Dateien.
import { useEffect, useState } from 'react'
import { deriveKek, generateDekRaw, generatePassphrase, randomSaltB64, unwrapDek, wrapDek } from '@/lib/clientCrypto'
import { cacheDekRaw, fetchEncConfig, type EncConfig } from '@/lib/keyStore'

// Zertifikat/Ausdruck (Stefan 2026-07-09, #102): druckt die aktuell im
// Formular stehende Passphrase auf ein eigenes Blatt statt sie nur in der
// Zwischenablage/im Kopf zu behalten — gedacht zum sicheren Verwahren
// (Tresor o. ä.), NICHT zum digitalen Speichern. Läuft komplett im Browser
// über ein neues Fenster + window.print(), nichts geht an den Server.
function printCertificate(passphrase: string, tenantName: string | null) {
  const w = window.open('', '_blank', 'width=650,height=820')
  if (!w) return
  const now = new Date().toLocaleString('de-DE')
  w.document.write(`<!DOCTYPE html><html><head><title>Passphrase-Zertifikat</title><meta charset="utf-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;padding:48px;color:#111}
    h1{font-size:18px;margin:0 0 4px}
    .sub{font-size:12px;color:#666;margin:0 0 24px}
    .pass{font-family:'Courier New',monospace;font-size:22px;letter-spacing:1px;background:#f3f4f6;
      border:1px solid #ccc;border-radius:10px;padding:20px;margin:24px 0;text-align:center;word-break:break-all}
    .warn{border:1px solid #d97706;background:#fffbeb;color:#92400e;padding:14px;border-radius:8px;font-size:13px;line-height:1.5}
    .meta{font-size:11px;color:#999;margin-top:32px}
  </style></head><body>
    <h1>E-Invoice — Passphrase-Zertifikat</h1>
    <p class="sub">${tenantName ? `${tenantName} — ` : ''}erzeugt am ${now}</p>
    <div class="pass">${passphrase}</div>
    <div class="warn"><strong>Wichtig:</strong> Diese Passphrase schützt Ihre verschlüsselten Belege
      (Zero-Knowledge — nur Sie besitzen sie). Geht sie verloren, sind die Belege unwiederbringlich
      verloren; es gibt keinen Wiederherstellungsweg, auch nicht durch den Betreiber. Diesen Ausdruck
      sicher und getrennt vom Computer aufbewahren (z. B. Tresor).</div>
    <p class="meta">Bitte nach dem Ausdrucken nicht digital speichern, fotografieren oder per E-Mail versenden.</p>
  </body></html>`)
  w.document.close()
  w.focus()
  w.print()
}

export function EncryptionSetup() {
  const [cfg, setCfg] = useState<EncConfig | null>(null)
  const [pass1, setPass1] = useState('')
  const [pass2, setPass2] = useState('')
  const [oldPass, setOldPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  // Zeigt die Passphrase einmal offen an, nachdem sie generiert wurde — sonst
  // sähe der Nutzer nie, was in den maskierten Feldern gelandet ist.
  const [revealed, setRevealed] = useState('')
  const [copyMsg, setCopyMsg] = useState('')

  useEffect(() => {
    fetchEncConfig().then(setCfg).catch(() => setErr('Konfiguration nicht ladbar.'))
  }, [])

  if (!cfg) return null

  function generate() {
    const p = generatePassphrase()
    setPass1(p)
    setPass2(p)
    setRevealed(p)
    setCopyMsg('')
  }

  async function copyRevealed() {
    try {
      await navigator.clipboard.writeText(revealed)
      setCopyMsg('In die Zwischenablage kopiert.')
    } catch {
      setCopyMsg('Kopieren nicht möglich — bitte manuell markieren.')
    }
  }

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
      setCfg({ enabled: true, salt, wrappedDek, tenantName: cfg?.tenantName ?? null })
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
      setCfg({ enabled: true, salt, wrappedDek, tenantName: cfg?.tenantName ?? null })
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
          <button type="button" className="btn-secondary !text-xs" onClick={generate}
            title="Erzeugt eine zufällige, sehr starke Passphrase (125 Bit) — gedacht zum Ausdrucken/Verwahren statt Merken">
            🎲 Zufällige Passphrase generieren
          </button>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="dp-label">Passphrase (min. 10 Zeichen)</label>
              <input type="password" className="dp-input mt-1" value={pass1}
                onChange={(e) => { setPass1(e.target.value); setRevealed('') }} />
            </div>
            <div>
              <label className="dp-label">Passphrase wiederholen</label>
              <input type="password" className="dp-input mt-1" value={pass2}
                onChange={(e) => { setPass2(e.target.value); setRevealed('') }} />
            </div>
          </div>
          <PassphraseReveal revealed={revealed} tenantName={cfg.tenantName} copyMsg={copyMsg} onCopy={copyRevealed} />
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
          <button type="button" className="btn-secondary !text-xs" onClick={generate}
            title="Erzeugt eine zufällige, sehr starke Passphrase (125 Bit) — gedacht zum Ausdrucken/Verwahren statt Merken">
            🎲 Zufällige Passphrase generieren
          </button>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="dp-label">Aktuelle Passphrase</label>
              <input type="password" className="dp-input mt-1" value={oldPass}
                onChange={(e) => setOldPass(e.target.value)} />
            </div>
            <div>
              <label className="dp-label">Neue Passphrase</label>
              <input type="password" className="dp-input mt-1" value={pass1}
                onChange={(e) => { setPass1(e.target.value); setRevealed('') }} />
            </div>
            <div>
              <label className="dp-label">Neue wiederholen</label>
              <input type="password" className="dp-input mt-1" value={pass2}
                onChange={(e) => { setPass2(e.target.value); setRevealed('') }} />
            </div>
          </div>
          <PassphraseReveal revealed={revealed} tenantName={cfg.tenantName} copyMsg={copyMsg} onCopy={copyRevealed} />
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

/** Zeigt eine frisch generierte Passphrase einmal offen an (sonst nie sichtbar,
 *  da die Felder maskiert sind) + Kopieren/Zertifikat-Druck (Stefan 2026-07-09, #102). */
function PassphraseReveal({
  revealed, tenantName, copyMsg, onCopy,
}: {
  revealed: string
  tenantName: string | null
  copyMsg: string
  onCopy: () => void
}) {
  if (!revealed) return null
  return (
    <div className="rounded-lg border border-[var(--accent-soft)] bg-[var(--accent-bg)] p-3 space-y-2">
      <p className="text-[11px] font-medium text-[var(--accent)]">
        Generierte Passphrase — jetzt notieren/drucken, sie wird hier nicht noch einmal angezeigt:
      </p>
      <p className="break-all rounded bg-white px-3 py-2 font-mono text-sm">{revealed}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary !px-2 !py-1 text-xs" onClick={onCopy}>
          Kopieren
        </button>
        <button type="button" className="btn-secondary !px-2 !py-1 text-xs"
          onClick={() => printCertificate(revealed, tenantName)}
          title="Öffnet ein druckbares Zertifikat mit dieser Passphrase — zum Ausdrucken und sicher Verwahren (z. B. Tresor)">
          🖨 Zertifikat drucken
        </button>
        {copyMsg && <span className="text-[11px] text-gray-500">{copyMsg}</span>}
      </div>
    </div>
  )
}
