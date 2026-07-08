'use client'

// Körbe-Verwaltung (Stefan 2026-07-08): oben eine symbolische Kachelleiste
// zum Auswählen, darunter alle Eigenschaften nur noch des GERADE AKTIVEN
// Korbs — vorher stand jeder Korb als eigene lange Karte untereinander, was
// bei mehreren Körben schnell unübersichtlich wurde.
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { BasketKindIcon, TrashIcon } from '@/components/baskets/BasketStrip'

type Member = { id: string; email: string; username: string }
type RightRow = { userId: string; email: string; right: string }
type BasketRow = {
  id: string
  name: string
  kind: 'INBOX' | 'HANDOVER' | 'CUSTOM' | 'ARCHIVE'
  fourEyesEnabled: boolean
  notificationEnabled: boolean
  notificationIntervalHours: number | null
  invoiceCount: number
  members: Member[]
  rights: RightRow[]
}
/** Papierkorb für Körbe (Stefan 2026-07-08) — nur leere Körbe lassen sich
 * löschen (siehe DELETE-Route), landen dann hier und lassen sich wiederherstellen. */
type DeletedBasketRow = { id: string; name: string; kind: BasketRow['kind']; deletedAt: string }

// Korb-Rechte je Mitarbeiter (Stefan 2026-07-08, umgestellt von Rolle auf
// direkte Mitarbeiter-Auswahl — die Rollen-Zuordnung hat in der Praxis nur
// verwirrt): sechsstufige Rangfolge, jede Stufe schließt alle darunter
// liegenden Rechte ein. Nur der Mandanten-Admin sieht und ändert diese Liste
// — die ganze Seite /admin/baskets ist bereits auf TENANT_ADMIN/
// OPERATOR_ADMIN beschränkt (siehe page.tsx).
const RIGHT_OPTIONS: { value: string; label: string }[] = [
  { value: 'VIEW', label: 'Korb sehen' },
  { value: 'CONTENT', label: 'Inhalt anzeigen' },
  { value: 'MOVE', label: 'Verschieben' },
  { value: 'APPROVE', label: 'Sachlich freigeben' },
  { value: 'HANDOVER', label: 'Übergabe an den Übergabekorb' },
  { value: 'FIBU', label: 'Übergabe an die Fibu' },
]

const KIND_LABEL: Record<BasketRow['kind'], string> = {
  INBOX: 'Eingangskorb (fest)',
  HANDOVER: 'Übergabekorb (fest)',
  CUSTOM: 'Eigener Korb',
  ARCHIVE: 'Ablage (fest, nach Übergabe)',
}

const KIND_STYLE: Record<BasketRow['kind'], { ring: string; iconBg: string; iconFg: string }> = {
  INBOX: { ring: 'border-[var(--accent)]', iconBg: 'bg-[var(--accent)]', iconFg: 'text-white' },
  HANDOVER: { ring: 'border-[var(--warn-strong)]', iconBg: 'bg-[var(--warn)]', iconFg: 'text-white' },
  CUSTOM: { ring: 'border-[var(--accent-soft)]', iconBg: 'bg-[var(--accent-bg)]', iconFg: 'text-[var(--accent)]' },
  ARCHIVE: { ring: 'border-gray-400', iconBg: 'bg-gray-500', iconFg: 'text-white' },
}

// Ablage (Stefan 2026-07-09): Verschieben und alles darüber lässt sich dort
// niemandem außer Admin/Betreiber zuweisen (serverseitig ebenfalls erzwungen
// in admin/baskets/[id]/rights/route.ts) — nur diese zwei Stufen sind sinnvoll.
const ARCHIVE_RIGHT_OPTIONS: { value: string; label: string }[] = [
  { value: 'VIEW', label: 'Korb sehen' },
  { value: 'CONTENT', label: 'Inhalt anzeigen' },
]

export function BasketAdmin({
  baskets,
  allUsers,
  rightsUsers,
  deletedBaskets,
}: {
  baskets: BasketRow[]
  /** Für die Benachrichtigung-Mitarbeiter-Auswahl — alle aktiven Mitarbeiter. */
  allUsers: Member[]
  /** Für die Korb-Rechte-Auswahl — ohne Mandanten-Admin/Betreiber, die ohnehin immer alle Rechte haben. */
  rightsUsers: Member[]
  /** Papierkorb für Körbe — gelöschte (leere) Körbe zum Wiederherstellen. */
  deletedBaskets: DeletedBasketRow[]
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [addUserFor, setAddUserFor] = useState<Record<string, string>>({})
  const [addRightUserFor, setAddRightUserFor] = useState<Record<string, string>>({})
  const [addRightValueFor, setAddRightValueFor] = useState<Record<string, string>>({})
  const [activeId, setActiveId] = useState<string | null>(baskets[0]?.id ?? null)
  const [showDeleted, setShowDeleted] = useState(false)

  const active = baskets.find((b) => b.id === activeId) ?? baskets[0] ?? null

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

      <div className="dp-card">
        <p className="dp-label mb-3" title="Korb anklicken, um seine Einstellungen darunter zu bearbeiten">
          Körbe
        </p>
        <div className="flex flex-wrap gap-3">
          {deletedBaskets.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDeleted((s) => !s)}
              title="Gelöschte Körbe ansehen und wiederherstellen"
              className={`flex min-w-[160px] items-center gap-2.5 rounded-2xl border-2 bg-white px-4 py-3 text-left shadow-sm transition ${
                showDeleted ? 'border-gray-400 bg-gray-50 shadow-md' : 'border-[var(--line)] hover:border-gray-400 hover:shadow-md'
              }`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                showDeleted ? 'bg-gray-500 text-white' : 'bg-gray-100 text-gray-500'
              }`}>
                <TrashIcon />
              </span>
              <span className="min-w-0">
                <span className={`block truncate text-sm font-semibold ${showDeleted ? 'text-gray-700' : 'text-gray-800'}`}>
                  Gelöschte Körbe
                </span>
                <span className="block text-[11px] text-gray-500">{deletedBaskets.length} Korb/Körbe</span>
              </span>
            </button>
          )}
          {baskets.map((b) => {
            const isActive = !showDeleted && b.id === active?.id
            const style = KIND_STYLE[b.kind]
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => { setActiveId(b.id); setShowDeleted(false) }}
                title={`${KIND_LABEL[b.kind]} — ${b.invoiceCount} Rechnung(en)`}
                className={`flex min-w-[160px] items-center gap-2.5 rounded-2xl border-2 bg-white px-4 py-3 text-left shadow-sm transition ${
                  isActive ? `${style.ring} bg-[var(--accent-bg)] shadow-md` : 'border-[var(--line)] hover:border-[var(--accent-soft)] hover:shadow-md'
                }`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${style.iconBg} ${style.iconFg}`}>
                  <BasketKindIcon kind={b.kind} />
                </span>
                <span className="min-w-0">
                  <span className={`block truncate text-sm font-semibold ${isActive ? 'text-[var(--accent)]' : 'text-gray-800'}`}>
                    {b.name}
                  </span>
                  <span className="block text-[11px] text-gray-500">{b.invoiceCount} Rechnung(en)</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {showDeleted && (
        <div className="dp-card space-y-2">
          <p className="dp-label">Gelöschte Körbe</p>
          <p className="text-xs text-gray-500">
            Nur leere Körbe können gelöscht werden — Beleg und Recht-Zuordnungen bleiben erhalten und lassen sich hier wiederherstellen.
          </p>
          {deletedBaskets.length === 0 ? (
            <p className="text-xs text-gray-400">Papierkorb ist leer.</p>
          ) : (
            <div className="space-y-1.5">
              {deletedBaskets.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] px-3 py-2">
                  <span className="text-sm text-gray-700">
                    {b.name}
                    <span className="ml-2 text-xs text-gray-400">gelöscht am {new Date(b.deletedAt).toLocaleDateString('de-DE')}</span>
                  </span>
                  <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy}
                    onClick={() => call(`/api/admin/baskets/${b.id}`, 'PATCH', { restore: true })}>
                    Wiederherstellen
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!showDeleted && active && (
        <div className="dp-card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold text-[var(--fg)]">{active.name}</span>
              <span className="ml-2 text-xs text-gray-400">{KIND_LABEL[active.kind]}</span>
              <span className="ml-2 text-xs text-gray-400">· {active.invoiceCount} Rechnung(en)</span>
            </div>
            {active.kind === 'CUSTOM' && (
              <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy}
                onClick={async () => {
                  if (active.invoiceCount > 0) {
                    window.alert(`Korb enthält noch ${active.invoiceCount} Rechnung(en) — bitte zuerst verschieben.`)
                    return
                  }
                  if (!window.confirm(`Korb "${active.name}" löschen? Er landet im Papierkorb für Körbe und lässt sich dort wiederherstellen.`)) return
                  await call(`/api/admin/baskets/${active.id}`, 'DELETE')
                  setActiveId(null)
                }}>
                Korb löschen
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="accent-[var(--accent)]" checked={active.fourEyesEnabled}
                disabled={busy || active.kind !== 'CUSTOM'}
                onChange={(e) => call(`/api/admin/baskets/${active.id}`, 'PATCH', { fourEyesEnabled: e.target.checked })} />
              Vier-Augen-Prinzip {active.kind !== 'CUSTOM' && <span className="text-xs text-gray-400">(für feste Körbe nicht möglich)</span>}
            </label>
          </div>

          <div className="grid gap-6 border-t border-[var(--line)] pt-3 md:grid-cols-2">
            <div>
              <p className="dp-label mb-1" title="Jeder Mitarbeiter braucht eine eigene Zeile, um überhaupt etwas in diesem Korb zu sehen oder zu tun. Sechs Stufen, jede schließt die darunter liegenden ein: Korb sehen < Inhalt anzeigen < Verschieben < Sachlich freigeben < Übergabe an den Übergabekorb < Übergabe an die Fibu. Mandanten-Admin und Betreiber haben immer alle Rechte.">
                Korb-Rechte je Mitarbeiter
              </p>
              <div className="space-y-1.5">
                {active.rights.length === 0 && (
                  <p className="text-xs text-gray-400">Noch niemandem ein Recht zugewiesen — ohne Recht kein Zugriff.</p>
                )}
                {active.rights.map((r) => (
                  <div key={r.userId} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 truncate text-xs text-gray-600" title={r.email}>{r.email}</span>
                    <select
                      className="dp-input !w-auto !py-1 text-xs"
                      value={r.right}
                      disabled={busy}
                      onChange={(e) =>
                        call(`/api/admin/baskets/${active.id}/rights`, 'PUT', {
                          userId: r.userId,
                          right: e.target.value || null,
                        })
                      }
                    >
                      <option value="">Kein Zugriff</option>
                      {(active.kind === 'ARCHIVE' ? ARCHIVE_RIGHT_OPTIONS : RIGHT_OPTIONS).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {rightsUsers.filter((u) => !active.rights.some((r) => r.userId === u.id)).length > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <select className="dp-input !w-auto !py-1 text-xs"
                    value={addRightUserFor[active.id] ?? ''}
                    onChange={(e) => setAddRightUserFor((s) => ({ ...s, [active.id]: e.target.value }))}>
                    <option value="">Mitarbeiter auswählen…</option>
                    {rightsUsers.filter((u) => !active.rights.some((r) => r.userId === u.id)).map((u) => (
                      <option key={u.id} value={u.id}>{u.email}</option>
                    ))}
                  </select>
                  <select className="dp-input !w-auto !py-1 text-xs"
                    value={addRightValueFor[active.id] ?? ''}
                    onChange={(e) => setAddRightValueFor((s) => ({ ...s, [active.id]: e.target.value }))}>
                    <option value="">Recht wählen…</option>
                    {(active.kind === 'ARCHIVE' ? ARCHIVE_RIGHT_OPTIONS : RIGHT_OPTIONS).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <button className="btn-secondary !px-2 !py-1 text-xs"
                    disabled={busy || !addRightUserFor[active.id] || !addRightValueFor[active.id]}
                    onClick={async () => {
                      const userId = addRightUserFor[active.id]
                      const right = addRightValueFor[active.id]
                      if (!userId || !right) return
                      await call(`/api/admin/baskets/${active.id}/rights`, 'PUT', { userId, right })
                      setAddRightUserFor((s) => ({ ...s, [active.id]: '' }))
                      setAddRightValueFor((s) => ({ ...s, [active.id]: '' }))
                    }}>
                    Zuweisen
                  </button>
                </div>
              )}
            </div>

            {/* Ablage (ARCHIVE) ist ein fester Endlager-Korb ohne eigene
                Bearbeitung — eine Erinnerungsmail "X Belege liegen hier"
                ergibt dort keinen Sinn, die Mitarbeiter-Zuordnung unten dient
                nur als Empfängerliste für genau diese Mail (Stefan 2026-07-09). */}
            {active.kind !== 'ARCHIVE' && (
              <div>
                <label className="dp-label mb-1 flex items-center gap-2">
                  <input type="checkbox" className="accent-[var(--accent)]" checked={active.notificationEnabled}
                    disabled={busy}
                    onChange={(e) => call(`/api/admin/baskets/${active.id}`, 'PATCH', {
                      notificationEnabled: e.target.checked,
                      notificationIntervalHours: active.notificationIntervalHours ?? 24,
                    })} />
                  Benachrichtigung einschalten für Mitarbeiter
                </label>
                {active.notificationEnabled && (
                  <p className="mb-2 flex items-center gap-2 text-xs text-gray-600">
                    Sammel-E-Mail alle
                    <input type="number" min={1} max={720} className="dp-input !w-20 !py-1 text-xs"
                      defaultValue={active.notificationIntervalHours ?? 24} disabled={busy}
                      onBlur={(e) => {
                        const hours = Math.max(1, Number(e.target.value) || 24)
                        call(`/api/admin/baskets/${active.id}`, 'PATCH', { notificationIntervalHours: hours })
                      }} />
                    Stunde(n)
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {active.members.length === 0 && <span className="text-xs text-gray-400">Noch niemand ausgewählt</span>}
                  {active.members.map((m) => (
                    <span key={m.id} className="flex items-center gap-1 rounded-full bg-[var(--accent-bg)] px-2 py-0.5 text-xs text-[var(--accent)]">
                      {m.email}
                      <button className="ml-1 text-[var(--danger)]" disabled={busy}
                        onClick={() => call(`/api/admin/baskets/${active.id}/members`, 'DELETE', { userId: m.id })}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                {allUsers.filter((u) => !active.members.some((m) => m.id === u.id)).length > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <select className="dp-input !w-auto !py-1 text-xs"
                      value={addUserFor[active.id] ?? ''}
                      onChange={(e) => setAddUserFor((s) => ({ ...s, [active.id]: e.target.value }))}>
                      <option value="">Mitarbeiter auswählen…</option>
                      {allUsers.filter((u) => !active.members.some((m) => m.id === u.id)).map((u) => (
                        <option key={u.id} value={u.id}>{u.email}</option>
                      ))}
                    </select>
                    <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy || !addUserFor[active.id]}
                      onClick={async () => {
                        const userId = addUserFor[active.id]
                        if (!userId) return
                        await call(`/api/admin/baskets/${active.id}/members`, 'POST', { userId })
                        setAddUserFor((s) => ({ ...s, [active.id]: '' }))
                      }}>
                      Zuordnen
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
