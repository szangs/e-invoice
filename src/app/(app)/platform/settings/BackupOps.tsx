'use client'

// Betreiber-Sicherungsaktionen (§17): System-Download, Sofort-Lauf, Rücksicherung
import { useEffect, useRef, useState } from 'react'

type TenantOption = { id: string; name: string }

export function BackupOps() {
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [msg, setMsg] = useState('')
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [restoreTenantId, setRestoreTenantId] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Mandantenliste für die Rücksicherungs-Auswahl
    fetch('/api/platform/tenants', { cache: 'no-store' })
      .then(async (r) => (r.ok ? setTenants((await r.json()).tenants) : undefined))
      .catch(() => undefined)
  }, [])

  async function runNow() {
    setBusy(true)
    setLog([])
    setMsg('Führe fällige/aktivierte Sicherungen aus …')
    const res = await fetch('/api/platform/backup', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg(data.error ?? 'Lauf fehlgeschlagen.')
      return
    }
    setMsg('Sicherungslauf abgeschlossen.')
    setLog(data.log ?? [])
  }

  async function restore() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setMsg('Bitte zuerst eine Sicherungsdatei auswählen.')
      return
    }
    if (!window.confirm('Rücksicherung einspielen? Vorhandene Daten werden mit dem Sicherungsstand überschrieben/ergänzt.')) return
    setBusy(true)
    setMsg('Spiele Sicherung ein …')
    const fd = new FormData()
    fd.append('file', file)
    if (restoreTenantId) fd.append('tenantId', restoreTenantId)
    const res = await fetch('/api/platform/backup/restore', { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    setMsg(res.ok ? `Wiederhergestellt: ${data.message}` : data.error ?? 'Rücksicherung fehlgeschlagen.')
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <a className="btn-secondary" href="/api/platform/backup">System-Backup herunterladen</a>
        <button className="btn-primary" onClick={runNow} disabled={busy}>
          Alle aktivierten Sicherungen jetzt ausführen
        </button>
      </div>
      {log.length > 0 && (
        <ul className="rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-gray-700">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
      <div className="border-t border-[var(--line)] pt-3">
        <label className="dp-label">Rücksicherung (System- oder Mandantensicherung)</label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="application/json,.json" className="dp-input !w-auto" />
          <select className="dp-input !w-auto" value={restoreTenantId}
            onChange={(e) => setRestoreTenantId(e.target.value)}>
            <option value="">Ziel: automatisch / System</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>Mandant: {t.name}</option>
            ))}
          </select>
          <button className="btn-danger" onClick={restore} disabled={busy}>Wiederherstellen</button>
        </div>
        <p className="mt-1 text-[10px] text-gray-400">
          Systemsicherungen werden automatisch erkannt; bei Mandantensicherungen den Ziel-Mandanten wählen.
        </p>
      </div>
      {msg && <p className="text-sm text-gray-700">{msg}</p>}
    </div>
  )
}
