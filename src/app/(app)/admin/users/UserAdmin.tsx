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
// Mitarbeiter-Gruppen (Stefan 2026-08-26, hierher verschoben von /admin/
// baskets — "neue Gruppe bezieht sich auf die Mitarbeiter und muss dahin").
// Korb-Rechte für Gruppen bleiben in der Körbe-Verwaltung, hier nur Anlegen/
// Umbenennen/Löschen und Mitgliederpflege.
type GroupMember = { id: string; email: string }
type GroupRow = { id: string; name: string; members: GroupMember[] }

const ROLES: { value: string; label: string }[] = [
  { value: 'TENANT_ADMIN', label: 'Administrator' },
  { value: 'EDITOR', label: 'Bearbeiter' },
  { value: 'AREA_MANAGER', label: 'Bereichsleitung' },
  { value: 'AUDITOR', label: 'Prüfer' },
  { value: 'USER', label: 'Nutzer' },
]

const EMPTY = { email: '', firstName: '', lastName: '', department: '', jobTitle: '', role: 'EDITOR' }

// Neues Passwort (Stefan 2026-08-26, "Passwort neu ist nicht logisch"):
// vorher erzeugte der Knopf IMMER ein zufälliges Passwort ohne jede
// Eingabemöglichkeit, angezeigt in einem window.alert. Jetzt fragt ein
// kleiner Dialog direkt nach dem neuen Passwort — mit Option, stattdessen
// eins generieren zu lassen (füllt nur das Feld, nichts Verstecktes).
const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
const PW_SPECIAL = '!#$%+?'
function generateClientPassword(length = 12): string {
  const bytes = new Uint32Array(length)
  window.crypto.getRandomValues(bytes)
  let pw = ''
  for (let i = 0; i < length - 1; i++) pw += PW_CHARS[bytes[i] % PW_CHARS.length]
  pw += PW_SPECIAL[bytes[length - 1] % PW_SPECIAL.length]
  return pw
}

export function UserAdmin({
  users,
  maxUsers,
  currentCount,
  selfId,
  groups,
}: {
  users: UserRow[]
  maxUsers: number
  currentCount: number
  selfId: string
  groups: GroupRow[]
}) {
  const router = useRouter()
  const [f, setF] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [pwDialogFor, setPwDialogFor] = useState<UserRow | null>(null)
  const [pwValue, setPwValue] = useState('')
  const [pwError, setPwError] = useState('')
  const [addGroupMemberFor, setAddGroupMemberFor] = useState<Record<string, string>>({})

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

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
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
      return false
    }
    router.refresh()
    return true
  }

  // Generischer Aufruf für die Gruppen-Verwaltung (Stefan 2026-08-26) — die
  // Gruppen-API ist nicht auf einen bestimmten Benutzer bezogen wie patch()
  // oben, daher ein eigener, einfacherer Helfer.
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

  // Name wird erst beim Klicken abgefragt (wie beim Korb-Anlegen) statt
  // eines dauerhaft sichtbaren Eingabefelds — das Anlegen ist ein seltener
  // Vorgang, der so viel Platz nicht rechtfertigt.
  async function createGroup() {
    const input = window.prompt('Name der neuen Gruppe (z. B. "Einkauf", "Buchhaltung"):')
    if (!input || !input.trim()) return
    await call('/api/admin/groups', 'POST', { name: input.trim() })
  }

  function openPasswordDialog(u: UserRow) {
    setPwDialogFor(u)
    setPwValue('')
    setPwError('')
  }

  async function confirmPassword() {
    if (!pwDialogFor) return
    if (pwValue.length < 10) {
      setPwError('Mindestens 10 Zeichen.')
      return
    }
    const ok = await patch(pwDialogFor.id, { newPassword: pwValue })
    if (ok) {
      setMsg(`Neues Passwort für ${pwDialogFor.email} gesetzt.`)
      setPwDialogFor(null)
    }
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
                      title="Neues Passwort für diesen Benutzer festlegen"
                      onClick={() => openPasswordDialog(u)}>
                      Passwort neu
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mitarbeiter-Gruppen (Stefan 2026-08-26, hierher verschoben von
          /admin/baskets): fasst mehrere Mitarbeiter zusammen, um ihnen in der
          Körbe-Verwaltung gemeinsam ein Recht zuzuweisen, statt jedem
          einzeln. Anlegen/Mitglieder gehören zur Mitarbeiterverwaltung,
          Korb-Rechte je Gruppe weiterhin unter Admin → Körbe. */}
      <div className="dp-card space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="dp-label">Mitarbeiter-Gruppen</p>
            <p className="text-xs text-gray-500">Für gemeinsame Korb-Rechte mehrerer Mitarbeiter — Zuweisung selbst unter Admin → Körbe.</p>
          </div>
          <button type="button" className="btn-secondary !px-2 !py-1 text-xs" onClick={createGroup} disabled={busy}>
            + Neue Gruppe
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="text-xs text-gray-400">Noch keine Gruppen angelegt.</p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.id} className="rounded-lg border border-[var(--line)] p-3">
                <p className="text-sm font-semibold text-gray-700">👥 {g.name}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {g.members.length === 0 && <span className="text-xs text-gray-400">Noch niemand in dieser Gruppe</span>}
                  {g.members.map((m) => (
                    <span key={m.id} className="flex items-center gap-1 rounded-full bg-[var(--accent-bg)] px-2 py-0.5 text-xs text-[var(--accent)]">
                      {m.email}
                      <button className="ml-1 text-[var(--danger)]" disabled={busy}
                        title="Aus der Gruppe entfernen"
                        onClick={() => call(`/api/admin/groups/${g.id}/members`, 'DELETE', { userId: m.id })}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                {users.filter((u) => u.active && !g.members.some((m) => m.id === u.id)).length > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <select className="dp-input !w-auto !py-1 text-xs"
                      value={addGroupMemberFor[g.id] ?? ''}
                      onChange={(e) => setAddGroupMemberFor((s) => ({ ...s, [g.id]: e.target.value }))}>
                      <option value="">Mitarbeiter auswählen…</option>
                      {users.filter((u) => u.active && !g.members.some((m) => m.id === u.id)).map((u) => (
                        <option key={u.id} value={u.id}>{u.email}</option>
                      ))}
                    </select>
                    <button className="btn-secondary !px-2 !py-1 text-xs"
                      disabled={busy || !addGroupMemberFor[g.id]}
                      onClick={async () => {
                        const userId = addGroupMemberFor[g.id]
                        if (!userId) return
                        await call(`/api/admin/groups/${g.id}/members`, 'POST', { userId })
                        setAddGroupMemberFor((s) => ({ ...s, [g.id]: '' }))
                      }}>
                      Hinzufügen
                    </button>
                  </div>
                )}
                <button className="mt-2 text-xs text-[var(--danger)] hover:underline" disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Gruppe "${g.name}" löschen? Korb-Rechte dieser Gruppe gehen dabei verloren.`)) return
                    call(`/api/admin/groups/${g.id}`, 'DELETE')
                  }}>
                  Gruppe löschen
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {pwDialogFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPwDialogFor(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-lg font-semibold text-gray-800">Neues Passwort</h2>
            <p className="mt-1 text-xs text-gray-500">für {pwDialogFor.email}</p>
            <div className="mt-3 flex gap-2">
              <input
                className="dp-input flex-1 font-mono"
                type="text"
                value={pwValue}
                autoFocus
                placeholder="Neues Passwort eingeben …"
                onChange={(e) => { setPwValue(e.target.value); setPwError('') }}
              />
              <button
                type="button"
                className="btn-secondary shrink-0 text-xs"
                title="Zufälliges, gut lesbares Passwort einsetzen"
                onClick={() => { setPwValue(generateClientPassword()); setPwError('') }}
              >
                Generieren
              </button>
            </div>
            {pwError && <p className="mt-1.5 text-xs text-[var(--danger)]">{pwError}</p>}
            <p className="mt-1.5 text-[10px] text-gray-400">
              Mindestens 10 Zeichen. Der Benutzer wird bei der nächsten Anfrage abgemeldet und muss sich mit dem neuen Passwort erneut anmelden.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setPwDialogFor(null)}>Abbrechen</button>
              <button type="button" className="btn-primary" disabled={busy || pwValue.length < 10} onClick={confirmPassword}>
                Setzen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
