'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Member = { id: string; email: string; username: string }
type BasketRow = {
  id: string
  name: string
  kind: 'INBOX' | 'HANDOVER' | 'CUSTOM'
  fourEyesEnabled: boolean
  notificationEnabled: boolean
  notificationIntervalHours: number | null
  invoiceCount: number
  members: Member[]
}

const KIND_LABEL: Record<BasketRow['kind'], string> = {
  INBOX: 'Eingangskorb (fest)',
  HANDOVER: 'Übergabekorb (fest)',
  CUSTOM: 'Eigener Korb',
}

export function BasketAdmin({ baskets, allUsers }: { baskets: BasketRow[]; allUsers: Member[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [addUserFor, setAddUserFor] = useState<Record<string, string>>({})

  async function call(url: string, method: string, body?: Record<string, unknown>) {
    setBusy(true)
    setMsg('')
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg(data.error ?? 'Fehler')
      return null
    }
    router.refresh()
    return data
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    const ok = await call('/api/admin/baskets', 'POST', { name: name.trim() })
    if (ok) setName('')
  }

  return (
    <>
      <form onSubmit={create} className="dp-card flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="dp-label">Neuer Korb — Name</label>
          <input className="dp-input mt-1" value={name} required
            onChange={(e) => setName(e.target.value)} placeholder="z. B. Kostenstelle Einkauf" />
        </div>
        <button className="btn-primary" disabled={busy}>Anlegen</button>
        {msg && <p className="w-full text-sm text-[var(--danger)]">{msg}</p>}
      </form>

      <div className="space-y-4">
        {baskets.map((b) => {
          const availableUsers = allUsers.filter((u) => !b.members.some((m) => m.id === u.id))
          const isSystem = b.kind !== 'CUSTOM'
          return (
            <div key={b.id} className="dp-card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-semibold text-[var(--fg)]">{b.name}</span>
                  <span className="ml-2 text-xs text-gray-400">{KIND_LABEL[b.kind]}</span>
                  <span className="ml-2 text-xs text-gray-400">· {b.invoiceCount} Rechnung(en)</span>
                </div>
                {!isSystem && (
                  <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy}
                    onClick={() => call(`/api/admin/baskets/${b.id}`, 'DELETE')}>
                    Korb löschen
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-6 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="accent-[var(--accent)]" checked={b.fourEyesEnabled}
                    disabled={busy || isSystem}
                    onChange={(e) => call(`/api/admin/baskets/${b.id}`, 'PATCH', { fourEyesEnabled: e.target.checked })} />
                  Vier-Augen-Prinzip {isSystem && <span className="text-xs text-gray-400">(für feste Körbe nicht möglich)</span>}
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="accent-[var(--accent)]" checked={b.notificationEnabled}
                    disabled={busy}
                    onChange={(e) => call(`/api/admin/baskets/${b.id}`, 'PATCH', {
                      notificationEnabled: e.target.checked,
                      notificationIntervalHours: b.notificationIntervalHours ?? 24,
                    })} />
                  Sammel-Benachrichtigung an Korb-Mitglieder
                </label>
                {b.notificationEnabled && (
                  <span className="flex items-center gap-2">
                    alle
                    <input type="number" min={1} max={720} className="dp-input !w-20 !py-1 text-xs"
                      defaultValue={b.notificationIntervalHours ?? 24} disabled={busy}
                      onBlur={(e) => {
                        const hours = Math.max(1, Number(e.target.value) || 24)
                        call(`/api/admin/baskets/${b.id}`, 'PATCH', { notificationIntervalHours: hours })
                      }} />
                    Stunde(n)
                  </span>
                )}
              </div>

              <div>
                <p className="dp-label mb-1">Mitarbeiter im Korb</p>
                <div className="flex flex-wrap gap-1.5">
                  {b.members.length === 0 && <span className="text-xs text-gray-400">Noch niemand zugeordnet</span>}
                  {b.members.map((m) => (
                    <span key={m.id} className="flex items-center gap-1 rounded-full bg-[var(--accent-bg)] px-2 py-0.5 text-xs text-[var(--accent)]">
                      {m.email}
                      <button className="ml-1 text-[var(--danger)]" disabled={busy}
                        onClick={() => call(`/api/admin/baskets/${b.id}/members`, 'DELETE', { userId: m.id })}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                {availableUsers.length > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <select className="dp-input !w-auto !py-1 text-xs"
                      value={addUserFor[b.id] ?? ''}
                      onChange={(e) => setAddUserFor((s) => ({ ...s, [b.id]: e.target.value }))}>
                      <option value="">Mitarbeiter hinzufügen…</option>
                      {availableUsers.map((u) => (
                        <option key={u.id} value={u.id}>{u.email}</option>
                      ))}
                    </select>
                    <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy || !addUserFor[b.id]}
                      onClick={async () => {
                        const userId = addUserFor[b.id]
                        if (!userId) return
                        await call(`/api/admin/baskets/${b.id}/members`, 'POST', { userId })
                        setAddUserFor((s) => ({ ...s, [b.id]: '' }))
                      }}>
                      Zuordnen
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
