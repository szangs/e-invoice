'use client'

// Mandant anlegen (§7) — inkl. erstem Administrator und Zugangsdaten-Anzeige
import { useRouter } from 'next/navigation'
import { useState } from 'react'

const EMPTY = {
  slug: '', name: '', adminEmail: '', adminFirstName: '', adminLastName: '', contactName: '', contactEmail: '',
  street: '', zip: '', city: '', employeeCount: '0', maxUsers: '5',
  licensePlan: '', licenseSerial: '', licenseExpiresAt: '',
}

export default function NewTenantPage() {
  const router = useRouter()
  const [f, setF] = useState(EMPTY)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ email: string; password: string; mailInfo: string } | null>(null)

  function set(key: keyof typeof EMPTY, value: string) {
    setF((p) => ({ ...p, [key]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/platform/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Fehler beim Anlegen.')
        return
      }
      setResult({ ...data.credentials, mailInfo: data.mailInfo })
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className="dp-card max-w-lg">
        <h2 className="text-lg font-semibold text-gray-900">Mandant angelegt</h2>
        <p className="mt-3 text-sm text-gray-700">
          Zugangsdaten des ersten Administrators — <strong>Anmeldung mit E-Mail + Passwort</strong> (nicht mit dem technischen Benutzernamen):
        </p>
        <div className="mt-3 rounded-lg bg-[var(--surface-muted)] p-4 font-mono text-sm">
          <p>E-Mail: {result.email}</p>
          <p>Passwort: {result.password}</p>
        </div>
        <p className="mt-2 text-xs text-gray-500">{result.mailInfo}</p>
        <button className="btn-primary mt-4" onClick={() => { router.push('/platform'); router.refresh() }}>
          Zum Cockpit
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="dp-card max-w-2xl space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Anzeigename *" value={f.name} onChange={(v) => set('name', v)} required />
        <Field label="Kurzname / Slug *" value={f.slug} onChange={(v) => set('slug', v.toLowerCase())}
          required placeholder="z. b. mustermann" hint="klein, Ziffern, Bindestrich" />
        <Field label="Admin-E-Mail (erster Administrator) *" type="email" value={f.adminEmail}
          onChange={(v) => set('adminEmail', v)} required />
        <Field label="Vorname des Administrators *" value={f.adminFirstName}
          onChange={(v) => set('adminFirstName', v)} required />
        <Field label="Nachname des Administrators *" value={f.adminLastName}
          onChange={(v) => set('adminLastName', v)}
          required hint="Für den Benutzernamen (vorname.nachname) — kein Mandanten-Kurzname als Präfix" />
        <Field label="Kontakt-E-Mail" type="email" value={f.contactEmail} onChange={(v) => set('contactEmail', v)} />
        <Field label="Ansprechpartner" value={f.contactName} onChange={(v) => set('contactName', v)} />
        <Field label="Straße" value={f.street} onChange={(v) => set('street', v)} />
        <Field label="PLZ" value={f.zip} onChange={(v) => set('zip', v)} />
        <Field label="Ort" value={f.city} onChange={(v) => set('city', v)} />
        <Field label="Beschäftigtenzahl" type="number" value={f.employeeCount} onChange={(v) => set('employeeCount', v)} />
        <Field label="Max. Benutzer" type="number" value={f.maxUsers} onChange={(v) => set('maxUsers', v)} />
        <Field label="Tarif/Umfang" value={f.licensePlan} onChange={(v) => set('licensePlan', v)} />
        <Field label="Seriennummer" value={f.licenseSerial} onChange={(v) => set('licenseSerial', v)} />
        <Field label="Lizenz-Ablauf (leer = unbegrenzt)" type="date" value={f.licenseExpiresAt}
          onChange={(v) => set('licenseExpiresAt', v)} />
      </div>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Lege an …' : 'Mandant anlegen'}
        </button>
        <button type="button" className="btn-secondary" onClick={() => router.push('/platform')}>
          Abbrechen
        </button>
      </div>
    </form>
  )
}

function Field({
  label, value, onChange, type = 'text', required, placeholder, hint,
}: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; required?: boolean; placeholder?: string; hint?: string
}) {
  return (
    <div>
      <label className="dp-label">{label}</label>
      <input className="dp-input mt-1" type={type} value={value} required={required}
        placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="mt-0.5 text-[10px] text-gray-400">{hint}</p>}
    </div>
  )
}
