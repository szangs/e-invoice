'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type UserRow = {
  id: string
  email: string
  username: string
  firstName: string | null
  lastName: string | null
  department: string | null
  jobTitle: string | null
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

const EMPTY = { email: '', firstName: '', lastName: '', department: '', jobTitle: '', role: 'EDITOR' }

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
  const [f, setF] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(f),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) {
      setMsg(data.error ?? 'Fehler')
      return
    }
    window.alert(
      `Benutzer angelegt.\n\nE-Mail: ${data.credentials.email}\nBenutzername: ${data.credentials.username}\n` +
      `Startpasswort: ${data.credentials.password}\n\nAnmeldung mit E-Mail + Passwort.`,
    )
    setF(EMPTY)
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
        <div className="min-w-[140px]">
          <label className="dp-label" title="Wird für die Anmeldung und den Benutzernamen-Vorschlag verwendet">Vorname</label>
          <input className="dp-input mt-1" value={f.firstName} required
            onChange={(e) => setF((p) => ({ ...p, firstName: e.target.value }))} />
        </div>
        <div className="min-w-[140px]">
          <label className="dp-label">Nachname</label>
          <input className="dp-input mt-1" value={f.lastName} required
            onChange={(e) => setF((p) => ({ ...p, lastName: e.target.value }))} />
        </div>
        <div className="min-w-[220px] flex-1">
          <label className="dp-label" title="Für Anmeldung und Benachrichtigungen">E-Mail</label>
          <input className="dp-input mt-1" type="email" value={f.email} required
            onChange={(e) => setF((p) => ({ ...p, email: e.target.value }))} />
        </div>
        <div className="min-w-[140px]">
          <label className="dp-label" title="Optional — erscheint in der Mitarbeiterliste">Abteilung</label>
          <input className="dp-input mt-1" value={f.department}
            onChange={(e) => setF((p) => ({ ...p, department: e.target.value }))} />
        </div>
        <div className="min-w-[140px]">
          <label className="dp-label" title="Optional — z. B. Sachbearbeiter, Teamleitung">Funktion</label>
          <input className="dp-input mt-1" value={f.jobTitle}
            onChange={(e) => setF((p) => ({ ...p, jobTitle: e.target.value }))} />
        </div>
        <div>
          <label className="dp-label" title="Bestimmt, welche Bereiche der Benutzer sehen und bearbeiten darf">Rolle</label>
          <select className="dp-input mt-1" value={f.role} onChange={(e) => setF((p) => ({ ...p, role: e.target.value }))}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <button className="btn-primary" disabled={busy || currentCount >= maxUsers}
          title="Legt den Benutzer an und erzeugt ein Startpasswort">
          Anlegen
        </button>
        <p className="w-full text-xs text-gray-400">
          {currentCount} / {maxUsers} Benutzern belegt
          {currentCount >= maxUsers && ' — Obergrenze erreicht, bitte Betreiber kontaktieren.'}
        </p>
        {msg && <p className="w-full text-sm text-[var(--danger)]">{msg}</p>}
      </form>

      <div className="dp-card overflow-x-auto p-0">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="dp-tr">
              <th className="dp-th">Name</th>
              <th className="dp-th" title="Abteilung / Funktion">Abteilung / Funktion</th>
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
                <td className="dp-td">
                  {u.firstName || u.lastName ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() : <span className="text-gray-400">—</span>}
                </td>
                <td className="dp-td text-xs text-gray-500">
                  {[u.department, u.jobTitle].filter(Boolean).join(' · ') || '—'}
                </td>
                <td className="dp-td">{u.email}</td>
                <td className="dp-td font-mono text-xs">{u.username}</td>
                <td className="dp-td">
                  <select className="dp-input !w-auto !py-1 text-xs" value={u.role} disabled={busy || u.id === selfId}
                    title="Rolle ändern" onChange={(e) => patch(u.id, { role: e.target.value })}>
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
                      title={u.active ? 'Anmeldung sperren' : 'Anmeldung wieder erlauben'}
                      onClick={() => patch(u.id, { active: !u.active })}>
                      {u.active ? 'Deaktivieren' : 'Aktivieren'}
                    </button>
                    <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy}
                      title="Neues Startpasswort erzeugen und anzeigen"
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
