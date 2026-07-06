'use client'

// Anmeldeseite — zweistufig (§5): Vorprüfung → ggf. Mandanten-Auswahl → Sitzung.
// Auth-Seiten erhalten keinen App-Chrome (DP-Standard §4.5).
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type TenantOption = { tenantId: string; tenantName: string }

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tenants, setTenants] = useState<TenantOption[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function precheck(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/auth/precheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? `Anmeldung fehlgeschlagen (Status ${res.status}).`)
        return
      }
      const list: TenantOption[] = data.tenants
      if (list.length === 1) await finish(list[0].tenantId)
      else setTenants(list)
    } catch {
      setError('Server nicht erreichbar — läuft "npm run dev" noch? Bitte das Terminal auf Fehler prüfen.')
    } finally {
      setBusy(false)
    }
  }

  async function finish(tenantId: string) {
    setBusy(true)
    const res = await signIn('credentials', { email, password, tenantId, redirect: false })
    setBusy(false)
    if (res?.error) {
      setError('Anmeldung fehlgeschlagen. Bitte erneut versuchen.')
      return
    }
    router.push(tenantId === 'operator' ? '/platform' : '/dashboard')
    router.refresh()
  }

  return (
    <div className="app-bg flex min-h-screen items-center justify-center p-4">
      <div className="dp-card w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent)] font-serif text-lg font-bold text-white">
            €
          </div>
          <div>
            <p className="text-[16px] font-bold text-[var(--accent)]">E-Invoice</p>
            <p className="text-[12px] text-gray-400">Rechnungsautomatisierung · deltaplus</p>
          </div>
        </div>

        {tenants === null ? (
          <form onSubmit={precheck} className="space-y-4">
            <div>
              <label className="dp-label" htmlFor="email">E-Mail</label>
              <input id="email" type="email" className="dp-input mt-1" value={email}
                onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            <div>
              <label className="dp-label" htmlFor="password">Passwort</label>
              <input id="password" type="password" className="dp-input mt-1" value={password}
                onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
            <button type="submit" className="btn-primary w-full justify-center" disabled={busy}>
              {busy ? 'Prüfe …' : 'Anmelden'}
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Ihre E-Mail ist mehreren Firmen zugeordnet. Bitte wählen Sie:
            </p>
            {tenants.map((t) => (
              <button key={t.tenantId} onClick={() => finish(t.tenantId)} disabled={busy}
                className="btn-secondary w-full justify-between">
                <span>{t.tenantName}</span>
                <span aria-hidden>→</span>
              </button>
            ))}
            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
            <button className="text-xs text-gray-400 underline" onClick={() => setTenants(null)}>
              Zurück
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-[10px] font-mono text-gray-300">
          © 2026/2026 Delta Plus Systemhaus GmbH – EDV Lösungen
        </p>
      </div>
    </div>
  )
}
