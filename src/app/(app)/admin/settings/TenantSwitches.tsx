'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

type Switches = {
  aiAllowed: boolean
  ipLoggingAllowed: boolean
  backupEnabled: boolean
  defaultLanguage: string
  mailAllowedDomains: string
  backupFrequency: string
  backupEmail: string
  reportEnabled: boolean
  reportFrequency: string
  reportEmail: string
}

const FREQUENCIES = [
  { value: 'DAILY', label: 'täglich' },
  { value: 'WEEKLY', label: 'wöchentlich' },
  { value: 'MONTHLY', label: 'monatlich' },
  { value: 'YEARLY', label: 'jährlich' },
]

export function TenantSwitches({ initial }: { initial: Switches }) {
  const router = useRouter()
  const [s, setS] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [backupMsg, setBackupMsg] = useState('')
  const [reportMsg, setReportMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function save() {
    setBusy(true)
    setMsg('')
    const res = await fetch('/api/admin/tenant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    })
    setBusy(false)
    setMsg(res.ok ? 'Gespeichert.' : 'Speichern fehlgeschlagen.')
    router.refresh()
  }

  async function sendBackupNow() {
    setBusy(true)
    setBackupMsg('')
    const res = await fetch('/api/admin/backup', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    setBackupMsg(res.ok ? data.message : data.error ?? 'Versand fehlgeschlagen.')
  }

  async function sendReportNow() {
    setBusy(true)
    setReportMsg('')
    const res = await fetch('/api/admin/report', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    setReportMsg(res.ok ? data.message : data.error ?? 'Versand fehlgeschlagen.')
  }

  async function restore() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setBackupMsg('Bitte zuerst eine Sicherungsdatei auswählen.')
      return
    }
    if (!window.confirm('Rücksicherung einspielen? Vorhandene Daten werden mit dem Sicherungsstand überschrieben/ergänzt.')) return
    setBusy(true)
    setBackupMsg('Spiele Sicherung ein …')
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/admin/backup/restore', { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    setBackupMsg(res.ok ? `Wiederhergestellt: ${data.message}` : data.error ?? 'Rücksicherung fehlgeschlagen.')
    router.refresh()
  }

  const toggle = (key: 'aiAllowed' | 'ipLoggingAllowed', label: string, hint?: string) => (
    <label className="flex items-start gap-2 text-sm text-gray-700">
      <input type="checkbox" className="mt-0.5" checked={s[key]}
        onChange={(e) => setS((p) => ({ ...p, [key]: e.target.checked }))} />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-gray-400">{hint}</span>}
      </span>
    </label>
  )

  return (
    <>
      <section className="dp-card space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Schalter</h2>
        {toggle('aiAllowed', 'KI-Funktionen erlauben', 'Bei "aus" werden keine Daten an eine KI übergeben — serverseitig erzwungen.')}
        {toggle('ipLoggingAllowed', 'IP-Protokollierung erlauben')}
        <div>
          <label className="dp-label">E-Mail-Eingang: nur Absender dieser Domänen</label>
          <input className="dp-input mt-1" value={s.mailAllowedDomains}
            placeholder="z. B. meinefirma.de, lieferant.de — leer = alle"
            onChange={(e) => setS((p) => ({ ...p, mailAllowedDomains: e.target.value }))} />
        </div>
        <div>
          <label className="dp-label">Standardsprache</label>
          <select className="dp-input mt-1 !w-auto" value={s.defaultLanguage}
            onChange={(e) => setS((p) => ({ ...p, defaultLanguage: e.target.value }))}>
            <option value="de">Deutsch</option>
            <option value="en">Englisch</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Speichere …' : 'Speichern'}</button>
          {msg && <span className={`text-sm ${msg === 'Gespeichert.' ? 'text-[var(--accent)]' : 'text-[var(--danger)]'}`}>{msg}</span>}
        </div>
      </section>

      <section className="dp-card space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Datensicherung (§17)</h2>
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" className="mt-0.5" checked={s.backupEnabled}
            onChange={(e) => setS((p) => ({ ...p, backupEnabled: e.target.checked }))} />
          <span>Regelmäßige Sicherung aktiv — wird automatisch per E-Mail zugestellt</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="dp-label">Häufigkeit</label>
            <select className="dp-input mt-1" value={s.backupFrequency}
              onChange={(e) => setS((p) => ({ ...p, backupFrequency: e.target.value }))}>
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="dp-label">Ziel-E-Mail</label>
            <input type="email" className="dp-input mt-1" value={s.backupEmail}
              placeholder="z. B. backup@meinefirma.de"
              onChange={(e) => setS((p) => ({ ...p, backupEmail: e.target.value }))} />
          </div>
        </div>
        <p className="text-[11px] text-gray-400">
          Einstellungen mit „Speichern" oben sichern. Die Sicherung enthält Stammdaten, Benutzer,
          Rechnungen und Belegdateien — verschlüsselte Belege bleiben verschlüsselt.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a className="btn-secondary" href="/api/admin/backup">Backup herunterladen</a>
          <button className="btn-secondary" onClick={sendBackupNow} disabled={busy}>
            Jetzt per E-Mail senden
          </button>
        </div>
        <div className="border-t border-[var(--line)] pt-3">
          <label className="dp-label">Rücksicherung (Sicherungsdatei einspielen)</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept="application/json,.json" className="dp-input !w-auto" />
            <button className="btn-danger" onClick={restore} disabled={busy}>Wiederherstellen</button>
          </div>
        </div>
        {backupMsg && <p className="text-sm text-gray-700">{backupMsg}</p>}
      </section>

      <section className="dp-card space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Revisionssicherer Bericht</h2>
        <p className="text-[11px] text-gray-400">
          Schlankes Protokoll (CSV) mit Ihrer Rechnungsliste und den Beleg-Prüfsummen — zur
          eigenen Ablage/Dokumentation, unabhängig von E-Invoice. Anders als die Sicherung oben
          kein voller Datenexport, sondern nur die Liste + Hashes, verkettet mit dem letzten Bericht.
        </p>
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" className="mt-0.5" checked={s.reportEnabled}
            onChange={(e) => setS((p) => ({ ...p, reportEnabled: e.target.checked }))} />
          <span>Regelmäßiger Bericht aktiv — wird automatisch per E-Mail zugestellt</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="dp-label">Häufigkeit</label>
            <select className="dp-input mt-1" value={s.reportFrequency}
              onChange={(e) => setS((p) => ({ ...p, reportFrequency: e.target.value }))}>
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="dp-label">Ziel-E-Mail</label>
            <input type="email" className="dp-input mt-1" value={s.reportEmail}
              placeholder="z. B. ablage@meinefirma.de"
              onChange={(e) => setS((p) => ({ ...p, reportEmail: e.target.value }))} />
          </div>
        </div>
        <p className="text-[11px] text-gray-400">
          Einstellungen mit „Speichern" oben sichern.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a className="btn-secondary" href="/api/admin/report">Bericht herunterladen</a>
          <button className="btn-secondary" onClick={sendReportNow} disabled={busy}>
            Jetzt per E-Mail senden
          </button>
        </div>
        {reportMsg && <p className="text-sm text-gray-700">{reportMsg}</p>}
      </section>
    </>
  )
}
