'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Switches = {
  aiAllowed: boolean
  ipLoggingAllowed: boolean
  backupEnabled: boolean
  defaultLanguage: string
}

export function TenantSwitches({ initial }: { initial: Switches }) {
  const router = useRouter()
  const [s, setS] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

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

  const toggle = (key: 'aiAllowed' | 'ipLoggingAllowed' | 'backupEnabled', label: string, hint?: string) => (
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
    <section className="dp-card space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Schalter</h2>
      {toggle('aiAllowed', 'KI-Funktionen erlauben', 'Bei "aus" werden keine Daten an eine KI übergeben — serverseitig erzwungen.')}
      {toggle('ipLoggingAllowed', 'IP-Protokollierung erlauben')}
      {toggle('backupEnabled', 'Regelmäßige Sicherung', 'Automatischer Versand folgt in Runde 2.')}
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
  )
}
