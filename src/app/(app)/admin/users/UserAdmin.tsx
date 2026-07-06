'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type UserRow = {
  id: string
  email: string
  username: string
  role: string
  active: boolean
  lastLogin: string
}

const ROLES: { value: string; label: string }[] = [
  { value: 'TENANT_ADMIN', label: 'Administrator' },
  { value: 'EDITOR', label: 'Bearbeiter' },
  { value: 'AREA_MANAGER', label: 'Bereichsleitung' },
  { value: 'AUDITOR', label: 'Prüfer' },
  { value: 'USER', label: 'Nutzer' },
]

export function UserAdmin({
  users,
  maxUsers,
  currentCount,
  selfId,
}: {
  users: UserRow[]
  maxUsers: number
  currentCount: number
  selfId: string
}) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('EDITOR')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) {
      setMsg(data.error ?? 'Fehler')
      return
    }
    window.alert(`Benutzer angelegt.\n\nE-Mail: ${data.credentials.email}\nStartpasswort: ${data.credentials.password}\n\nAnmeldung mit E-Mail + Passwort.`)
    setEmail('')
    router.refresh()
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true)
    setMsg('')
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg(data.error ?? 'Fehler')
      return
    }
    if (data.credentials) {
      window.alert(`Neues Passwort für ${data.credentials.email}:\n${data.credentials.password}`)
    }
    router.refresh()
  }

  return (
    <>
      <form onSubmit={create} className="dp-card flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="dp-label">Neuer Benutzer — E-Mail</label>
          <input className="dp-input mt-1" type="email" value={email} required
            onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="dp-label">Rolle</label>
          <select className="dp-input mt-1" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <button className="btn-primary" disabled={busy || currentCount >= maxUsers}>Anlegen</button>
        <p className="w-full text-xs text-gray-400">
          {currentCount} / {maxUsers} Benutzern belegt
          {currentCount >= maxUsers && ' — Obergrenze erreicht, bitte Betreiber kontaktieren.'}
        </p>
        {msg && <p className="w-full text-sm text-[var(--danger)]">{msg}</p>}
      </form>

      <div className="dp-card overflow-x-auto p-0">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="dp-tr">
              <th className="dp-th">E-Mail</th>
              <th className="dp-th">Benutzername</th>
              <th className="dp-th">Rolle</th>
              <th className="dp-th">Status</th>
              <th className="dp-th">Letzte Anmeldung</th>
              <th className="dp-th">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="dp-tr">
                <td className="dp-td">{u.email}</td>
                <td className="dp-td font-mono text-xs">{u.username}</td>
                <td className="dp-td">
                  <select className="dp-input !w-auto !py-1 text-xs" value={u.role} disabled={busy || u.id === selfId}
                    onChange={(e) => patch(u.id, { role: e.target.value })}>
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </td>
                <td className="dp-td">
                  {u.active ? (
                    <span className="rounded-full bg-[var(--accent-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--accent)]">aktiv</span>
                  ) : (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-[var(--danger)]">deaktiviert</span>
                  )}
                </td>
                <td className="dp-td text-xs">{u.lastLogin}</td>
                <td className="dp-td">
                  <div className="flex gap-1.5 whitespace-nowrap">
                    <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy || u.id === selfId}
                      onClick={() => patch(u.id, { active: !u.active })}>
                      {u.active ? 'Deaktivieren' : 'Aktivieren'}
                    </button>
                    <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy}
                      onClick={() => patch(u.id, { resetPassword: true })}>
                      Passwort neu
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
