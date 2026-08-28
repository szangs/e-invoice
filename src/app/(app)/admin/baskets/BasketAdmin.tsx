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
// Mitarbeiter-Gruppen (Stefan 2026-08-26) — siehe EmployeeGroup in schema.prisma.
type GroupMember = { id: string; email: string }
type GroupRow = { id: string; name: string; members: GroupMember[] }
type GroupRightRow = { groupId: string; name: string; right: string }
type BasketRow = {
  id: string
  name: string
  kind: 'INBOX' | 'HANDOVER' | 'CUSTOM' | 'ARCHIVE' | 'QUARANTINE'
  fourEyesEnabled: boolean
  notificationEnabled: boolean
  notificationIntervalHours: number | null
  invoiceCount: number
  members: Member[]
  rights: RightRow[]
  groupRights: GroupRightRow[]
  /** Belegfluss (Stefan 2026-08-25) — Ziel-Körbe, in die aus diesem Korb
   * verschoben werden darf. Leer = uneingeschränkt (siehe lib/baskets.ts requestMove). */
  allowedTargetIds: string[]
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
// Stefan 2026-08-26 (Review-Fund): explizites Kürzel je Recht statt aus dem
// ersten Buchstaben des Labels abgeleitet — "Übergabe an den Übergabekorb"
// und "Übergabe an die Fibu" fingen beide mit "Ü" an, zwei Spalten der
// Rechte-Tabelle waren dadurch nicht mehr unterscheidbar (Risiko, versehentlich
// das weitreichendere Fibu-Recht statt nur Übergabekorb zu vergeben).
const RIGHT_OPTIONS: { value: string; label: string; short: string }[] = [
  { value: 'VIEW', label: 'Korb sehen', short: 'S' },
  { value: 'CONTENT', label: 'Inhalt anzeigen', short: 'I' },
  { value: 'MOVE', label: 'Verschieben', short: 'V' },
  { value: 'APPROVE', label: 'Sachlich freigeben', short: 'A' },
  { value: 'HANDOVER', label: 'Übergabe an den Übergabekorb', short: 'Ü' },
  { value: 'FIBU', label: 'Übergabe an die Fibu', short: 'F' },
]

const KIND_LABEL: Record<BasketRow['kind'], string> = {
  INBOX: 'Eingangskorb (fest)',
  HANDOVER: 'Übergabekorb (fest)',
  CUSTOM: 'Eigener Korb',
  ARCHIVE: 'Ablage (fest, nach Übergabe)',
  QUARANTINE: 'Spam/Fehlleitung (fest, Mail-Eingang-Klassifikation)',
}

const KIND_STYLE: Record<BasketRow['kind'], { ring: string; iconBg: string; iconFg: string }> = {
  INBOX: { ring: 'border-[var(--accent)]', iconBg: 'bg-[var(--accent)]', iconFg: 'text-white' },
  HANDOVER: { ring: 'border-[var(--warn-strong)]', iconBg: 'bg-[var(--warn)]', iconFg: 'text-white' },
  CUSTOM: { ring: 'border-[var(--accent-soft)]', iconBg: 'bg-[var(--accent-bg)]', iconFg: 'text-[var(--accent)]' },
  ARCHIVE: { ring: 'border-gray-400', iconBg: 'bg-gray-500', iconFg: 'text-white' },
  QUARANTINE: { ring: 'border-[var(--danger)]', iconBg: 'bg-[var(--danger)]', iconFg: 'text-white' },
}

// Ablage (Stefan 2026-07-09): Verschieben und alles darüber lässt sich dort
// niemandem außer Admin/Betreiber zuweisen (serverseitig ebenfalls erzwungen
// in admin/baskets/[id]/rights/route.ts) — nur diese zwei Stufen sind sinnvoll.
const ARCHIVE_RIGHT_OPTIONS: { value: string; label: string; short: string }[] = [
  { value: 'VIEW', label: 'Korb sehen', short: 'S' },
  { value: 'CONTENT', label: 'Inhalt anzeigen', short: 'I' },
]

export function BasketAdmin({
  baskets,
  allUsers,
  rightsUsers,
  deletedBaskets,
  groups,
}: {
  baskets: BasketRow[]
  /** Für die Benachrichtigung-Mitarbeiter-Auswahl — alle aktiven Mitarbeiter. */
  allUsers: Member[]
  /** Für die Korb-Rechte-Auswahl — ohne Mandanten-Admin/Betreiber, die ohnehin immer alle Rechte haben. */
  rightsUsers: Member[]
  /** Papierkorb für Körbe — gelöschte (leere) Körbe zum Wiederherstellen. */
  deletedBaskets: DeletedBasketRow[]
  /** Mitarbeiter-Gruppen (Stefan 2026-08-26) — für Korb-Rechte je Gruppe. */
  groups: GroupRow[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [addUserFor, setAddUserFor] = useState<Record<string, string>>({})
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

  // Name wird erst beim Klicken abgefragt (Stefan 2026-08-25) statt eines
  // dauerhaft sichtbaren Eingabefelds über der Körbe-Leiste — das Anlegen
  // ist ein seltener Vorgang, der so viel Platz nicht rechtfertigt.
  async function create() {
    const input = window.prompt('Name des neuen Korbs:')
    if (!input || !input.trim()) return
    await call('/api/admin/baskets', 'POST', { name: input.trim() })
  }

  return (
    <>
      {msg && <p className="dp-card text-sm text-[var(--danger)]">{msg}</p>}

      <div className="dp-card">
        <p className="dp-label mb-3" title="Korb anklicken, um seine Einstellungen darunter zu bearbeiten">
          Körbe
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {/* Reihenfolge (Stefan 2026-08-25): Eingangskorb + eigene Körbe zuerst
              (Bearbeitungsfluss), dann "+ Neuer Korb" mit Abstand (ml-auto)
              als Trenner vor den festen End-Körben Übergabekorb/Ablage, ganz
              rechts "Gelöschte Körbe" als eigener, abgesetzter Bereich. */}
          {baskets.filter((b) => b.kind !== 'HANDOVER' && b.kind !== 'ARCHIVE').map((b) => (
            <BasketTile key={b.id} b={b} isActive={!showDeleted && b.id === active?.id}
              onClick={() => { setActiveId(b.id); setShowDeleted(false) }} />
          ))}
          <button
            type="button"
            onClick={create}
            disabled={busy}
            title="Neuen Korb anlegen — fragt den Namen ab"
            className="ml-auto flex min-w-[160px] items-center gap-2.5 rounded-2xl border-2 border-dashed border-[var(--line)] bg-white px-4 py-3 text-left text-gray-500 shadow-sm transition hover:border-[var(--accent-soft)] hover:text-[var(--accent)] hover:shadow-md"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-xl leading-none">
              +
            </span>
            <span className="text-sm font-semibold">Neuer Korb</span>
          </button>
          {baskets.filter((b) => b.kind === 'HANDOVER' || b.kind === 'ARCHIVE').map((b) => (
            <BasketTile key={b.id} b={b} isActive={!showDeleted && b.id === active?.id}
              onClick={() => { setActiveId(b.id); setShowDeleted(false) }} />
          ))}
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
                    title="Korb wiederherstellen — erscheint wieder in der Körbe-Liste mit allen Rechten und Mitgliedern"
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
                title="Nur leere Körbe können gelöscht werden — landet im Papierkorb für Körbe und lässt sich dort wiederherstellen"
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
            <label className="flex items-center gap-2"
              title="Ein Beleg wird erst aus diesem Korb verschoben, wenn mindestens zwei verschiedene Mitarbeiter zugestimmt haben">
              <input type="checkbox" className="accent-[var(--accent)]" checked={active.fourEyesEnabled}
                disabled={busy || active.kind !== 'CUSTOM'}
                onChange={(e) => call(`/api/admin/baskets/${active.id}`, 'PATCH', { fourEyesEnabled: e.target.checked })} />
              Vier-Augen-Prinzip {active.kind !== 'CUSTOM' && <span className="text-xs text-gray-400">(für feste Körbe nicht möglich)</span>}
            </label>
          </div>

          <div className="grid gap-6 border-t border-[var(--line)] pt-3 md:grid-cols-2">
            <div>
              {/* Korb-Rechte, eine Tabelle für Mitarbeiter UND Gruppen (Stefan
                  2026-08-26, "die Rechte sollten anders vergeben werden"):
                  vorher zwei getrennte Listen mit je einem eigenen "Zuweisen"-
                  Dropdown-Umweg. Jetzt eine Zeile pro Mitarbeiter/Gruppe,
                  Rechtsstufe direkt anklickbar — kein Auswahl-Umweg mehr.
                  Individuelles Mitarbeiter-Recht ersetzt ein eventuelles
                  Gruppenrecht auf demselben Korb komplett (siehe lib/
                  basketRights.ts), gilt NICHT mehr nur ergänzend. */}
              <p className="dp-label mb-1" title="Ohne Zeile bzw. ohne angeklickte Stufe: kein Zugriff. Sechs Stufen, jede schließt die darunter liegenden ein: Korb sehen < Inhalt anzeigen < Verschieben < Sachlich freigeben < Übergabe an den Übergabekorb < Übergabe an die Fibu. Ein individuelles Mitarbeiter-Recht ersetzt ein etwaiges Gruppenrecht auf diesem Korb vollständig. Mandanten-Admin und Betreiber haben immer alle Rechte, erscheinen deshalb nicht in der Liste. Gruppen werden unter Admin → Benutzer angelegt und verwaltet.">
                Korb-Rechte
              </p>
              {rightsUsers.length === 0 && groups.length === 0 ? (
                <p className="text-xs text-gray-400">Noch keine Mitarbeiter oder Gruppen vorhanden.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="pb-1 text-left font-normal text-gray-400">Name</th>
                      {(active.kind === 'ARCHIVE' ? ARCHIVE_RIGHT_OPTIONS : RIGHT_OPTIONS).map((o) => (
                        <th key={o.value} className="pb-1 text-center font-normal text-gray-400" title={o.label}>
                          {o.short}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rightsUsers.map((u) => {
                      const current = active.rights.find((r) => r.userId === u.id)?.right ?? ''
                      return (
                        <tr key={u.id}>
                          <td className="max-w-[160px] truncate py-0.5 text-gray-600" title={u.email}>👤 {u.email}</td>
                          {(active.kind === 'ARCHIVE' ? ARCHIVE_RIGHT_OPTIONS : RIGHT_OPTIONS).map((o) => (
                            <RightCell key={o.value} option={o} current={current} disabled={busy}
                              onClick={() => call(`/api/admin/baskets/${active.id}/rights`, 'PUT', {
                                userId: u.id,
                                right: current === o.value ? null : o.value,
                              })} />
                          ))}
                        </tr>
                      )
                    })}
                    {groups.map((g) => {
                      const current = active.groupRights.find((r) => r.groupId === g.id)?.right ?? ''
                      return (
                        <tr key={g.id}>
                          <td className="max-w-[160px] truncate py-0.5 text-gray-600" title={g.name}>👥 {g.name}</td>
                          {(active.kind === 'ARCHIVE' ? ARCHIVE_RIGHT_OPTIONS : RIGHT_OPTIONS).map((o) => (
                            <RightCell key={o.value} option={o} current={current} disabled={busy}
                              onClick={() => call(`/api/admin/baskets/${active.id}/group-rights`, 'PUT', {
                                groupId: g.id,
                                right: current === o.value ? null : o.value,
                              })} />
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Ablage (ARCHIVE) ist ein fester Endlager-Korb ohne eigene
                Bearbeitung — eine Erinnerungsmail "X Belege liegen hier"
                ergibt dort keinen Sinn, die Mitarbeiter-Zuordnung unten dient
                nur als Empfängerliste für genau diese Mail (Stefan 2026-07-09). */}
            {active.kind !== 'ARCHIVE' && (
              <div>
                <label className="dp-label mb-1 flex items-center gap-2"
                  title="Schickt den unten ausgewählten Mitarbeitern eine Sammel-E-Mail über unbearbeitete Belege in diesem Korb">
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
                        title="Aus der Benachrichtigungsliste dieses Korbs entfernen"
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

          <details className="border-t border-[var(--line)] pt-3" open>
            <summary className="dp-label mb-1 cursor-pointer select-none"
              title="Legt fest, aus welchen/in welche Körbe hinein verschoben werden darf. Ohne Auswahl bleibt das jeweils uneingeschränkt — erst mit mindestens einem Haken wird es auf die ausgewählten Körbe beschränkt.">
              Belegfluss ▾
            </summary>
            {baskets.filter((b) => b.id !== active.id).length === 0 ? (
              <p className="text-xs text-gray-400">Keine weiteren Körbe vorhanden.</p>
            ) : (
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-600">Eingehend — erlaubte Quell-Körbe</p>
                  <p className="mb-1.5 text-[11px] text-gray-500">
                    Welche anderen Körbe dürfen HIERHER verschieben — ändert deren eigenen Belegfluss (Ausgehend), nicht den dieses Korbs.
                  </p>
                  <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                    {baskets.filter((b) => b.id !== active.id).map((b) => (
                      <label key={b.id} className="flex items-center gap-1.5 text-sm text-gray-700">
                        <input type="checkbox" className="accent-[var(--accent)]" disabled={busy}
                          checked={b.allowedTargetIds.includes(active.id)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...b.allowedTargetIds, active.id]
                              : b.allowedTargetIds.filter((id) => id !== active.id)
                            call(`/api/admin/baskets/${b.id}/transitions`, 'PUT', { targetBasketIds: next })
                          }} />
                        {b.name}
                        {b.allowedTargetIds.length === 0 && (
                          <span className="text-[10px] text-gray-400">(aktuell uneingeschränkt)</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-600">Ausgehend — erlaubte Ziel-Körbe</p>
                  <p className="mb-1.5 text-[11px] text-gray-500">
                    {active.allowedTargetIds.length === 0
                      ? 'Uneingeschränkt — Verschieben aus diesem Korb heraus ist überallhin möglich.'
                      : 'Verschieben aus diesem Korb ist nur noch in die ausgewählten Ziele möglich.'}
                  </p>
                  <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                    {baskets.filter((b) => b.id !== active.id).map((b) => (
                      <label key={b.id} className="flex items-center gap-1.5 text-sm text-gray-700">
                        <input type="checkbox" className="accent-[var(--accent)]" disabled={busy}
                          checked={active.allowedTargetIds.includes(b.id)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...active.allowedTargetIds, b.id]
                              : active.allowedTargetIds.filter((id) => id !== b.id)
                            call(`/api/admin/baskets/${active.id}/transitions`, 'PUT', { targetBasketIds: next })
                          }} />
                        {b.name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </details>
        </div>
      )}
    </>
  )
}

// Reihenfolge für die kumulative Einfärbung in RightCell — unabhängig davon,
// ob gerade alle sechs Stufen (RIGHT_OPTIONS) oder nur die zwei für die
// Ablage erlaubten (ARCHIVE_RIGHT_OPTIONS) angezeigt werden.
const FULL_RIGHT_ORDER = RIGHT_OPTIONS.map((o) => o.value)

/** Eine anklickbare Rechtsstufe in der Korb-Rechte-Tabelle — gefüllt, wenn
 * sie <= der aktuell gesetzten Stufe liegt (Stufen schließen sich kumulativ
 * ein), sonst nur umrandet. Klick auf die aktuell gesetzte Stufe setzt auf
 * "kein Zugriff" zurück (siehe onClick-Logik am Aufrufort). */
function RightCell({
  option, current, disabled, onClick,
}: {
  option: { value: string; label: string; short: string }
  current: string
  disabled: boolean
  onClick: () => void
}) {
  const filled = current !== '' && FULL_RIGHT_ORDER.indexOf(option.value) <= FULL_RIGHT_ORDER.indexOf(current)
  return (
    <td className="py-0.5 text-center">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        title={`${option.label}${current === option.value ? ' (klicken zum Entfernen)' : ''}`}
        className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold transition ${
          filled
            ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
            : 'border-gray-300 bg-white text-gray-400 hover:border-[var(--accent-soft)]'
        }`}
      >
        {option.short}
      </button>
    </td>
  )
}

function BasketTile({ b, isActive, onClick }: { b: BasketRow; isActive: boolean; onClick: () => void }) {
  const style = KIND_STYLE[b.kind]
  return (
    <button
      type="button"
      onClick={onClick}
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
}
