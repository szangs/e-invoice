'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export type TenantFormData = {
  id: string; slug: string; name: string; contactName: string; contactEmail: string
  street: string; zip: string; city: string; employeeCount: string; maxUsers: string
  licensePlan: string; licenseSerial: string; licenseExpiresAt: string
  aiAllowed: boolean; ipLoggingAllowed: boolean; backupEnabled: boolean
  defaultLanguage: string; active: boolean
}

export function TenantEditForm({ tenant }: { tenant: TenantFormData }) {
  const router = useRouter()
  const [f, setF] = useState(tenant)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    const res = await fetch(`/api/platform/tenants/${tenant.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: f.name,
        contactName: f.contactName,
        contactEmail: f.contactEmail,
        street: f.street,
        zip: f.zip,
        city: f.city,
        employeeCount: Number(f.employeeCount),
        maxUsers: Number(f.maxUsers),
        licensePlan: f.licensePlan,
        licenseSerial: f.licenseSerial,
        licenseExpiresAt: f.licenseExpiresAt || null,
        aiAllowed: f.aiAllowed,
        ipLoggingAllowed: f.ipLoggingAllowed,
        backupEnabled: f.backupEnabled,
        defaultLanguage: f.defaultLanguage,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setMsg(data.error ?? 'Speichern fehlgeschlagen.')
      return
    }
    setMsg('Gespeichert.')
    router.refresh()
  }

  const input = (key: keyof TenantFormData, label: string, type = 'text') => (
    <div>
      <label className="dp-label">{label}</label>
      <input className="dp-input mt-1" type={type} value={String(f[key])}
        onChange={(e) => setF((p) => ({ ...p, [key]: e.target.value }))} />
    </div>
  )
  const toggle = (key: 'aiAllowed' | 'ipLoggingAllowed' | 'backupEnabled', label: string) => (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" checked={f[key]}
        onChange={(e) => setF((p) => ({ ...p, [key]: e.target.checked }))} />
      {label}
    </label>
  )

  return (
    <form onSubmit={submit} className="dp-card max-w-2xl space-y-4">
      <p className="text-xs text-gray-400">
        Kurzname: <span className="font-mono">{f.slug}</span> · Status:{' '}
        {f.active ? 'aktiv' : 'gesperrt'} (Sperren/Entsperren im Cockpit)
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {input('name', 'Anzeigename')}
        {input('contactName', 'Ansprechpartner')}
        {input('contactEmail', 'Kontakt-E-Mail', 'email')}
        {input('street', 'Straße')}
        {input('zip', 'PLZ')}
        {input('city', 'Ort')}
        {input('employeeCount', 'Beschäftigtenzahl', 'number')}
        {input('maxUsers', 'Max. Benutzer', 'number')}
        {input('licensePlan', 'Tarif/Umfang')}
        {input('licenseSerial', 'Seriennummer')}
        {input('licenseExpiresAt', 'Lizenz-Ablauf (leer = unbegrenzt)', 'date')}
        <div>
          <label className="dp-label">Standardsprache</label>
          <select className="dp-input mt-1" value={f.defaultLanguage}
            onChange={(e) => setF((p) => ({ ...p, defaultLanguage: e.target.value }))}>
            <option value="de">Deutsch</option>
            <option value="en">Englisch</option>
          </select>
        </div>
      </div>
      <div className="space-y-2 rounded-lg bg-[var(--surface-muted)] p-4">
        <p className="dp-label">Mandantenspezifische Schalter</p>
        {toggle('aiAllowed', 'KI-Funktionen erlaubt (§19 — serverseitig erzwungen)')}
        {toggle('ipLoggingAllowed', 'IP-Protokollierung erlaubt (§18)')}
        {toggle('backupEnabled', 'Regelmäßige Sicherung aktiv (§17 — Versand folgt in Runde 2)')}
      </div>
      {msg && <p className={`text-sm ${msg === 'Gespeichert.' ? 'text-[var(--accent)]' : 'text-[var(--danger)]'}`}>{msg}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Speichere …' : 'Speichern'}</button>
        <button type="button" className="btn-secondary" onClick={() => router.push('/platform')}>Zurück</button>
      </div>
    </form>
  )
}
