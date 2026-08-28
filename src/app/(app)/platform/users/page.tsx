'use client'

// Plattform-Benutzerverwaltung (PL03): alle Benutzer aller Mandanten + Betreiber-Konten
import { useEffect, useState } from 'react'

type UserRow = {
  id: string
  email: string
  username: string
  role: string
  active: boolean
  tenantName: string | null
  tenantActive: boolean
  lastLoginAt: string | null
  lastSeenAt: string | null
}

const ROLE_LABELS: Record<string, string> = {
  OPERATOR_ADMIN: 'Betreiber',
  TENANT_ADMIN: 'Administrator',
  EDITOR: 'Bearbeiter',
  AREA_MANAGER: 'Bereichsleitung',
  AUDITOR: 'Prüfer',
  USER: 'Nutzer',
}
const TENANT_ROLES = ['TENANT_ADMIN', 'EDITOR', 'AREA_MANAGER', 'AUDITOR', 'USER']

const EMPTY_CREATE = { firstName: '', lastName: '', email: '' }

export default function PlatformUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [f, setF] = useState(EMPTY_CREATE)

  async function load(query = q) {
    const res = await fetch(`/api/platform/users?q=${encodeURIComponent(query)}`, { cache: 'no-store' })
    if (res.ok) setUsers((await res.json()).users)
  }
  useEffect(() => {
    load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Betreiber-Konto anlegen (Stefan 2026-08-27, Review-Fund "Systemverwaltung
  // ohne Möglichkeit der Benutzeranlage") — keine Rollenauswahl nötig, ein
  // hier angelegtes Konto ist immer OPERATOR_ADMIN (siehe api/platform/users POST).
  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    const res = await fetch('/api/platform/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(f),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg(data.error ?? 'Fehler')
      return
    }
    window.alert(
      `Betreiber-Konto angelegt.\n\nE-Mail: ${data.credentials.email}\nBenutzername: ${data.credentials.username}\n` +
      `Startpasswort: ${data.credentials.password}\n\nAnmeldung mit E-Mail + Passwort.`,
    )
    setF(EMPTY_CREATE)
    load()
  }

  async function patch(id: string, body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    setMsg('')
    const res = await fetch(`/api/platform/users/${id}`, {
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
      window.alert(`Neues Passwort für ${data.credentials.email}:\n${data.credentials.password}\n\nAnmeldung mit E-Mail + Passwort.`)
    }
    load()
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="dp-card flex flex-wrap items-end gap-3">
        <div className="min-w-[140px]">
          <label className="dp-label" title="Nur für ein neues Betreiber-Konto — Mandanten-Mitarbeiter werden in der jeweiligen Mandanten-Benutzerverwaltung angelegt">Vorname</label>
          <input className="dp-input mt-1" value={f.firstName} required
            onChange={(e) => setF((p) => ({ ...p, firstName: e.target.value }))} />
        </div>
        <div className="min-w-[140px]">
          <label className="dp-label">Nachname</label>
          <input className="dp-input mt-1" value={f.lastName} required
            onChange={(e) => setF((p) => ({ ...p, lastName: e.target.value }))} />
        </div>
        <div className="min-w-[220px] flex-1">
          <label className="dp-label">E-Mail</label>
          <input className="dp-input mt-1" type="email" value={f.email} required
            onChange={(e) => setF((p) => ({ ...p, email: e.target.value }))} />
        </div>
        <button className="btn-primary" disabled={busy} title="Legt ein neues Betreiber-Konto (Rolle immer OPERATOR_ADMIN) an und erzeugt ein Startpasswort">
          Betreiber-Konto anlegen
        </button>
        {msg && <p className="w-full text-sm text-[var(--danger)]">{msg}</p>}
      </form>

      <form
        className="dp-card flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          load()
        }}
      >
        <div className="min-w-[240px] flex-1">
          <label className="dp-label">Suche (E-Mail, Benutzername, Mandant)</label>
          <input className="dp-input mt-1" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn-secondary" type="submit">Suchen</button>
        {msg && <p className="w-full text-sm text-[var(--danger)]">{msg}</p>}
      </form>

      <div className="dp-card overflow-x-auto p-0">
        <table className="w-full min-w-[980px]">
          <thead>
            <tr className="dp-tr">
              <th className="dp-th">E-Mail</th>
              <th className="dp-th">Mandant</th>
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
                  {u.email}
                  <p className="font-mono text-[10px] text-gray-400">{u.username}</p>
                </td>
                <td className="dp-td text-xs">
                  {u.tenantName ?? <span className="font-semibold text-[var(--accent)]">Betreiber-Ebene</span>}
                  {!u.tenantActive && <span className="ml-1 text-[var(--danger)]">(gesperrt)</span>}
                </td>
                <td className="dp-td">
                  {u.role === 'OPERATOR_ADMIN' ? (
                    <span className="text-xs font-semibold">{ROLE_LABELS[u.role]}</span>
                  ) : (
                    <select
                      className="dp-input !w-auto !py-1 text-xs"
                      value={u.role}
                      disabled={busy}
                      title="Rolle des Benutzers ändern — bestimmt, welche Bereiche er sehen und bearbeiten darf"
                      onChange={(e) => patch(u.id, { role: e.target.value })}
                    >
                      {TENANT_ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="dp-td">
                  {u.active ? (
                    <span className="rounded-full bg-[var(--accent-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--accent)]">aktiv</span>
                  ) : (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-[var(--danger)]">deaktiviert</span>
                  )}
                </td>
                <td className="dp-td text-xs">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('de-DE') : '—'}
                </td>
                <td className="dp-td">
                  <div className="flex gap-1.5 whitespace-nowrap">
                    <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy}
                      title={u.active ? 'Anmeldung dieses Benutzers sperren' : 'Anmeldung wieder erlauben'}
                      onClick={() => patch(u.id, { active: !u.active })}>
                      {u.active ? 'Deaktivieren' : 'Aktivieren'}
                    </button>
                    <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy}
                      title="Neues Passwort erzeugen und anzeigen"
                      onClick={() => patch(u.id, { resetPassword: true }, `Passwort für ${u.email} neu setzen?`)}>
                      Passwort neu
                    </button>
                    <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy}
                      title="Diesen Benutzer sofort aus allen aktiven Sitzungen abmelden"
                      onClick={() => patch(u.id, { forceLogout: true }, `${u.email} zwangsabmelden?`)}>
                      Abmelden
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td className="dp-td py-8 text-center text-gray-400" colSpan={6}>Keine Benutzer gefunden.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">
        Neue Benutzer legt der jeweilige Mandanten-Administrator an (BN01) — bei Bedarf per
        Identitätsübernahme aus dem Cockpit.
      </p>
    </div>
  )
}
