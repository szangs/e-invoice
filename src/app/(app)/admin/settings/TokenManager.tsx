'use client'

// API-Token für den Rechnungs-Catcher (Browser-Plugin) verwalten
import { useEffect, useState } from 'react'

type TokenRow = { id: string; label: string; createdAt: string; lastUsedAt: string | null }

export function TokenManager() {
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    const res = await fetch('/api/admin/tokens', { cache: 'no-store' })
    if (res.ok) setTokens((await res.json()).tokens)
  }
  useEffect(() => {
    load()
  }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const res = await fetch('/api/admin/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) {
      setErr(data.error ?? 'Fehler')
      return
    }
    window.alert(
      `API-Token für "${data.label}":\n\n${data.token}\n\nJETZT kopieren und im Browser-Plugin eintragen — er wird nur dieses eine Mal angezeigt!`,
    )
    setLabel('')
    load()
  }

  async function remove(id: string, tokenLabel: string) {
    if (!window.confirm(`Token "${tokenLabel}" widerrufen? Das Plugin kann damit nicht mehr hochladen.`)) return
    setBusy(true)
    await fetch(`/api/admin/tokens/${id}`, { method: 'DELETE' })
    setBusy(false)
    load()
  }

  return (
    <section className="dp-card space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
        Rechnungs-Catcher — Browser-Plugin
      </h2>
      <p className="text-xs text-gray-500">
        Das Plugin fängt Rechnungs-Downloads per <kbd className="rounded border px-1 font-mono">Strg+Alt+Klick</kbd>{' '}
        und überträgt sie hierher. Jede Installation braucht einen API-Token.
        Bei aktiver Beleg-Verschlüsselung überträgt das Plugin ausschließlich verschlüsselte Dateien.
      </p>
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label className="dp-label">Bezeichnung (z. B. „PC Buchhaltung&quot;)</label>
          <input className="dp-input mt-1" value={label} required maxLength={60}
            onChange={(e) => setLabel(e.target.value)} />
        </div>
        <button className="btn-primary" disabled={busy}>Token erstellen</button>
      </form>
      {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
      {tokens.length > 0 && (
        <table className="w-full">
          <thead>
            <tr className="dp-tr">
              <th className="dp-th">Bezeichnung</th>
              <th className="dp-th">Erstellt</th>
              <th className="dp-th">Zuletzt benutzt</th>
              <th className="dp-th"></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id} className="dp-tr">
                <td className="dp-td">{t.label}</td>
                <td className="dp-td text-xs">{new Date(t.createdAt).toLocaleDateString('de-DE')}</td>
                <td className="dp-td text-xs">
                  {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString('de-DE') : 'nie'}
                </td>
                <td className="dp-td">
                  <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy}
                    onClick={() => remove(t.id, t.label)}>
                    Widerrufen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
