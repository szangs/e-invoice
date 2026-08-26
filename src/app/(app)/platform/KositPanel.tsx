'use client'

// KoSIT-Validator: Status + Update (Stefan 2026-08-26) — die Installation
// (JRE + validator.jar + Schematron-Regelwerk) liegt serverweit unter
// tools/kosit/, siehe lib/kositSetup.ts. Prüfung selbst läuft je Rechnung
// über den Prüfbericht (InvoiceEditForm.tsx "KoSIT-Prüfung (offiziell)").
import { useEffect, useState } from 'react'

type Status = {
  installedFiles: boolean
  installed: { validatorVersion: string; configVersion: string; configTitle: string; installedAt: string } | null
  check:
    | { latestValidatorVersion: string; latestConfigVersion: string; latestConfigTitle: string; updateAvailable: boolean }
    | { error: string }
}

export function KositPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  function load() {
    fetch('/api/platform/kosit')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setMsg('Status konnte nicht geladen werden.'))
  }

  useEffect(load, [])

  async function update() {
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch('/api/platform/kosit', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(data.error ?? 'Update fehlgeschlagen.')
        return
      }
      setMsg(`Aktualisiert auf Validator ${data.versions.validatorVersion}, Regelwerk ${data.versions.configVersion}.`)
      load()
    } finally {
      setBusy(false)
    }
  }

  const check = status?.check && !('error' in status.check) ? status.check : null
  const checkError = status?.check && 'error' in status.check ? status.check.error : null

  return (
    <section className="dp-card space-y-2">
      <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">KoSIT-Validator (E-Rechnungs-Konformität)</h2>
      <p className="text-[11px] text-gray-400">
        Offizielle Schema-/Schematron-Prüfsoftware der Koordinierungsstelle für IT-Standards (KoSIT) — läuft
        serverweit als Java-Subprozess, wird pro Rechnung auf Knopfdruck im Prüfbericht ausgelöst.
      </p>
      {!status ? (
        <p className="text-xs text-gray-400">Lade …</p>
      ) : (
        <div className="space-y-1.5 text-xs">
          <p>
            Installiert:{' '}
            {status.installedFiles && status.installed
              ? `Validator ${status.installed.validatorVersion}, Regelwerk ${status.installed.configVersion}`
              : <span className="text-[var(--warn-strong)]">nicht installiert</span>}
          </p>
          {checkError && <p className="text-gray-400">Update-Prüfung nicht möglich: {checkError}</p>}
          {check && (
            <p className={check.updateAvailable ? 'text-[var(--warn-strong)]' : 'text-[var(--accent)]'}>
              {check.updateAvailable
                ? `Update verfügbar: Validator ${check.latestValidatorVersion}, Regelwerk ${check.latestConfigVersion}`
                : '✓ Auf neustem Stand'}
            </p>
          )}
          <button type="button" className="btn-secondary" disabled={busy} onClick={update}>
            {busy ? 'Installiere …' : status.installedFiles ? 'Jetzt aktualisieren' : 'Jetzt installieren'}
          </button>
          {msg && <p className="text-gray-600">{msg}</p>}
        </div>
      )}
    </section>
  )
}
